from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import subprocess
import threading
import time
import os
import signal
import uuid
import json

app = Flask(__name__)

# Configuración CORS más robusta
CORS(app, resources={r"/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000"]}}, 
     supports_credentials=True)

# Configuración SocketIO con orígenes CORS explícitos
socketio = SocketIO(app, 
                    cors_allowed_origins=["http://localhost:3000", "http://127.0.0.1:3000"], 
                    logger=True, 
                    engineio_logger=True)

# Variables globales
airodump_process = None
scan_lock = threading.Lock()
current_monitor_interface = None

def kill_previous_processes(interface):
    """
    Mata procesos previos relacionados con airmon-ng y el escaneo de redes
    """
    try:
        # Detiene procesos airmon-ng
        subprocess.run(["sudo", "airmon-ng", "check", "kill"], capture_output=True)
        
        # Si existe una interfaz monitor previa, detenerla
        if interface and interface.endswith('mon'):
            subprocess.run(["sudo", "airmon-ng", "stop", interface], capture_output=True)
    except Exception as e:
        print(f"Error al limpiar procesos previos: {e}")

@app.route('/list-devices', methods=['GET'])
def list_devices():
    """
    Listar las interfaces de red disponibles.
    """
    try:
        result = subprocess.run(['ip', 'link'], capture_output=True, text=True)
        devices = []
        for line in result.stdout.split('\n'):
            if ": " in line:
                device_name = line.split(': ')[1].split(':')[0]
                if device_name != "lo" and not device_name.endswith('mon'):
                    devices.append(device_name)
        return jsonify({'devices': devices})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/start-monitor', methods=['POST'])
def start_monitor():
    """
    Activar el modo monitor en una interfaz.
    """
    global current_monitor_interface
    try:
        interface = request.json.get('interface')
        if not interface:
            return jsonify({'error': 'Interface parameter missing'}), 400

        # Limpiar procesos previos
        kill_previous_processes(f"{interface}mon")

        # Iniciar modo monitor
        result = subprocess.run(
            f"sudo airmon-ng start {interface}",
            shell=True,
            capture_output=True,
            text=True
        )

        current_monitor_interface = f"{interface}mon"
        return jsonify({
            'output': result.stdout, 
            'monitor_interface': current_monitor_interface
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/stop-monitor', methods=['POST'])
def stop_monitor():
    """
    Desactivar el modo monitor en una interfaz.
    """
    global current_monitor_interface
    try:
        interface = request.json.get('interface')
        if not interface:
            return jsonify({'error': 'Interface parameter missing'}), 400

        monitor_interface = f"{interface}mon"

        result = subprocess.run(
            f"sudo airmon-ng stop {monitor_interface}",
            shell=True,
            capture_output=True,
            text=True
        )

        # Restaurar la interfaz original
        subprocess.run(f"sudo ip link set {interface} up", shell=True)
        current_monitor_interface = None

        return jsonify({
            'output': result.stdout, 
            'monitor_interface': monitor_interface
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/get-networks', methods=['GET'])
def get_networks():
    """
    Obtener redes WiFi disponibles en tiempo real.
    """
    global current_monitor_interface

    if not current_monitor_interface:
        return Response("Error: Interface not provided", status=400)

    def generate():
        # Configuración del prefijo de salida para el escaneo
        output_prefix = f'/tmp/airodump_{uuid.uuid4().hex}'
        cmd = [
            "sudo", "airodump-ng", 
            "--write", output_prefix, 
            "--output-format", "csv",
            current_monitor_interface
        ]

        try:
            # Ejecutar airodump-ng
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                preexec_fn=os.setsid
            )

            # Esperar al archivo generado
            csv_file = f"{output_prefix}-01.csv"
            seen_lines = set()  # Para evitar duplicados
            while process.poll() is None:
                if os.path.exists(csv_file):
                    with open(csv_file, 'r') as f:
                        for line in f:
                            # Evitar enviar líneas repetidas
                            if line not in seen_lines:
                                seen_lines.add(line)
                                yield f"data: {line.strip()}\n\n"
                time.sleep(2)  # Ajustar si se desea más frecuencia de actualización
        except Exception as e:
            yield f"data: Error: {str(e)}\n\n"
        finally:
            # Terminar proceso y limpiar archivos
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            for ext in ["-01.csv", "-01.kismet.csv", "-01.netxml"]:
                try:
                    os.remove(f"{output_prefix}{ext}")
                except FileNotFoundError:
                    pass

    return Response(generate(), mimetype='text/event-stream')

@app.route('/get-devices-in-network', methods=['GET'])
def get_devices_in_network():
    """
    Obtener dispositivos conectados a una red específica a través de airodump-ng.
    """
    bssid = request.args.get('bssid')
    channel = request.args.get('channel')
    interface = request.args.get('interface', current_monitor_interface)

    print(f"Scanning for devices - BSSID: {bssid}, Channel: {channel}, Interface: {interface}")

    if not bssid or not channel or not interface:
        return Response("Error: BSSID, channel, and interface must be provided", status=400)

    def generate():
        # Configuración del prefijo de salida para el escaneo
        output_prefix = f'/tmp/airodump_devices_{uuid.uuid4().hex}'
        cmd = [
            "sudo", "airodump-ng",
            interface, 
            "--bssid", bssid,
            "--channel", channel,
            "-w", output_prefix,
        ]

        try:
            # Ejecutar airodump-ng
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                preexec_fn=os.setsid
            )

            # Archivos de salida
            csv_station_file = f"{output_prefix}-01.csv"
            print(f"Output file will be: {csv_station_file}")

            last_check_time = time.time()

            while process.poll() is None:
                current_time = time.time()
                
                # Check file every 3 seconds
                if current_time - last_check_time >= 3:
                    last_check_time = current_time
                    
                    if os.path.exists(csv_station_file):
                        with open(csv_station_file, 'r') as f:
                            lines = f.readlines()
                            
                            # Encontrar la sección de estaciones
                            station_section = False
                            device_lines = []
                            
                            for line in lines:
                                if 'Station MAC' in line:
                                    station_section = True
                                    continue
                                
                                if station_section and line.strip():
                                    device_lines.append(line.strip())

                            # Procesar solo el primer y último dispositivo
                            if device_lines:
                                first_device_line = device_lines[0]
                                last_device_line = device_lines[-1]

                                # Parsear primer dispositivo
                                first_parts = [part.strip() for part in first_device_line.split(',')]
                                first_device_data = {
                                    'mac': first_parts[0],
                                    'first_seen': first_parts[1],
                                    'last_seen': first_parts[2],
                                    'power': first_parts[3],
                                    'packets': first_parts[4],
                                    'bssid': first_parts[5],
                                    'probed_essids': first_parts[6] if len(first_parts) > 6 else ''
                                }

                                # Parsear último dispositivo
                                last_parts = [part.strip() for part in last_device_line.split(',')]
                                last_device_data = {
                                    'mac': last_parts[0],
                                    'first_seen': last_parts[1],
                                    'last_seen': last_parts[2],
                                    'power': last_parts[3],
                                    'packets': last_parts[4],
                                    'bssid': last_parts[5],
                                    'probed_essids': last_parts[6] if len(last_parts) > 6 else ''
                                }

                                # Crear respuesta estructurada
                                response_data = {
                                    'type': 'devices',
                                    'data': {
                                        'first_device': first_device_data,
                                        'last_device': last_device_data
                                    }
                                }
                                
                                # Enviar datos por streaming
                                yield f"data: {json.dumps(response_data)}\n\n"
                                break  # Terminar después de procesar los dispositivos

                time.sleep(1)

        except Exception as e:
            print(f"Error in device scanning: {e}")
            error_response = {
                'type': 'error',
                'message': str(e)
            }
            yield f"data: {json.dumps(error_response)}\n\n"
        finally:
            # Terminar proceso
            try:
                if process.poll() is None:
                    os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass

    return Response(generate(), mimetype='text/event-stream')


@app.route('/stop-scan', methods=['POST'])
def stop_scan():
    """
    Detener el proceso de escaneo.
    """
    global current_monitor_interface
    try:
        if current_monitor_interface:
            # Detener airodump-ng
            subprocess.run(f"sudo pkill -f 'airodump-ng {current_monitor_interface}'", shell=True)
            
            # Limpiar archivos de escaneo
            subprocess.run("rm -f /tmp/wifi_scan/*", shell=True)
            
            return jsonify({'message': 'Scan stopped successfully'})
        return jsonify({'message': 'No active scan to stop'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Event listeners para conexiones de socket
@socketio.on('connect')
def handle_connect():
    print("Cliente conectado")

@socketio.on('disconnect')
def handle_disconnect():
    print("Cliente desconectado")

# Manejo de señales para limpieza al cerrar
def signal_handler(sig, frame):
    print('Limpiando recursos...')
    if current_monitor_interface:
        subprocess.run(f"sudo airmon-ng stop {current_monitor_interface}", shell=True)
    socketio.stop()

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)