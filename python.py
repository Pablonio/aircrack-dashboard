from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import threading
import re

app = Flask(__name__)
CORS(app)

# Variables globales
airodump_process = None
networks_data = []
scan_lock = threading.Lock()


def parse_airodump_line(line):
    """Parse a line from airodump-ng output"""
    try:
        # Ignorar líneas de encabezado y vacías
        if not line.strip() or "BSSID" in line or "CH" in line or "STATION" in line:
            return None

        # Dividir la línea en partes
        parts = line.split()
        if len(parts) >= 10:  # Asegurarse de que tenemos suficientes partes
            bssid = parts[0].strip()
            # Verificar si es un BSSID válido usando regex
            if re.match(r"([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", bssid):
                power = parts[1].strip()
                channel = parts[5].strip()
                encryption = parts[7].strip()
                # El ESSID puede contener espacios, así que unimos el resto
                essid = " ".join(parts[10:]).strip()

                return {
                    'bssid': bssid,
                    'power': power,
                    'channel': channel,
                    'encryption': encryption,
                    'essid': essid
                }
    except Exception as e:
        print(f"Error parsing line: {e}")
    return None


def run_airodump(interface):
    global airodump_process, networks_data
    try:
        cmd = f"airodump-ng {interface}mon"

        airodump_process = subprocess.Popen(
            cmd.split(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            bufsize=1
        )

        # Guardar salida en un archivo para supervisión
        with open('airodump_output.log', 'w') as log_file:
            while airodump_process and airodump_process.poll() is None:
                line = airodump_process.stderr.readline()
                if line:
                    log_file.write(line)
                    log_file.flush()  # Asegurar escritura inmediata al archivo
                    network = parse_airodump_line(line)
                    if network:
                        with scan_lock:
                            existing_network = next(
                                (n for n in networks_data if n['bssid'] == network['bssid']),
                                None
                            )
                            if existing_network:
                                existing_network.update(network)
                            else:
                                networks_data.append(network)
    except Exception as e:
        print(f"Error in run_airodump: {str(e)}")
    finally:
        if airodump_process:
            try:
                airodump_process.terminate()
            except:
                pass


@app.route('/list-devices', methods=['GET'])
def list_devices():
    try:
        result = subprocess.run(['ip', 'link'], capture_output=True, text=True)
        devices = []
        for line in result.stdout.split('\n'):
            if ": " in line:
                device_name = line.split(': ')[1].split(':')[0]
                if device_name != "lo":
                    devices.append(device_name)
        return jsonify({'devices': devices})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/start-monitor', methods=['POST'])
def start_monitor():
    try:
        interface = request.json.get('interface')
        if not interface:
            return jsonify({'error': 'Interface parameter missing'}), 400

        result = subprocess.run(
            f"airmon-ng start {interface}",
            shell=True,
            capture_output=True,
            text=True
        )
        return jsonify({'output': result.stdout})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/stop-monitor', methods=['POST'])
def stop_monitor():
    try:
        interface = request.json.get('interface')
        if not interface:
            return jsonify({'error': 'Interface parameter missing'}), 400

        result = subprocess.run(
            f"airmon-ng stop {interface}mon",
            shell=True,
            capture_output=True,
            text=True
        )
        return jsonify({'output': result.stdout})
    except Exception as e:
        if not interface:
            return jsonify({'error': 'Interface parameter missing'}), 400

        networks_data = []
        if airodump_process:
            airodump_process.terminate()
            airodump_process = None

        scan_thread = threading.Thread(target=run_airodump, args=(interface,))
        scan_thread.daemon = True
        scan_thread.start()

        return jsonify({'message': 'Scan started successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/get-networks', methods=['GET'])
def get_networks():
    global networks_data
    with scan_lock:
        return jsonify({'networks': networks_data})


@app.route('/stop-scan', methods=['POST'])
def stop_scan():
    global airodump_process, networks_data
    try:
        if airodump_process:
            airodump_process.terminate()
            airodump_process = None
            networks_data = []  # Limpiar datos
            return jsonify({'message': 'Scan stopped successfully'})
        return jsonify({'message': 'No active scan to stop'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True)
