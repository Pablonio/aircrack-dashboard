import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000';

function WifiScanner() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [monitorInterface, setMonitorInterface] = useState('');
  const [networks, setNetworks] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [networkDevices, setNetworkDevices] = useState([]);

  // Fetch available network devices
  const fetchDevices = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/list-devices`);
      setDevices(response.data.devices);
    } catch (error) {
      console.error('Error fetching devices:', error);
    }
  };

  // Start monitor mode
  const startMonitor = async () => {
    if (!selectedDevice) {
      alert('Please select a device');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/start-monitor`, { 
        interface: selectedDevice 
      });
      setMonitorInterface(response.data.monitor_interface);
      console.log('Monitor started:', response.data);
    } catch (error) {
      console.error('Error starting monitor:', error);
    }
  };

  // Stop monitor mode
  const stopMonitor = async () => {
    if (!monitorInterface) {
      alert('No monitor interface active');
      return;
    }

    try {
      await axios.post(`${API_BASE_URL}/stop-monitor`, { 
        interface: selectedDevice 
      });
      setMonitorInterface('');
      setScanning(false);
    } catch (error) {
      console.error('Error stopping monitor:', error);
    }
  };

  // Start network scan
  const startScan = async () => {
    if (!monitorInterface) {
      alert('Start monitor mode first');
      return;
    }

    setScanning(true);
    
    const parseNetworkData = (rawData) => {
      const networkLines = rawData.split('\n').filter(line => 
        line.includes(',') && !line.startsWith('Station MAC')
      );
    
      return networkLines.map(line => {
        const parts = line.split(',');
        if (parts.length >= 3) {
          return `${parts[0].trim()},${parts[3].trim()},${parts[parts.length - 2].trim()}`;
        } else {
          return null;
        }
      }).filter(network => network);
    };

    const eventSource = new EventSource(`${API_BASE_URL}/get-networks`);
    
    eventSource.onmessage = (event) => {
      const data = event.data;
      if (data) {
        console.log('Received data:', data);
        const parsedNetworks = parseNetworkData(data);
        setNetworks(prevNetworks => {
          const uniqueNetworks = [
            ...prevNetworks, 
            ...parsedNetworks.filter(
              newNet => !prevNetworks.some(
                existNet => existNet.split(',')[0] === newNet.split(',')[0]
              )
            )
          ];
          return uniqueNetworks;
        });
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      eventSource.close();
      setScanning(false);
    };
  };

  // Stop network scan
  const stopScan = async () => {
    try {
      await axios.post(`${API_BASE_URL}/stop-scan`);
      setScanning(false);
    } catch (error) {
      console.error('Error stopping scan:', error);
    }
  };

  // Fetch devices on component mount
  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevicesInNetwork = async (ssid, channel) => {
    try {
      const eventSource = new EventSource(`${API_BASE_URL}/get-devices-in-network?bssid=${ssid}&channel=${channel}`);
      
      eventSource.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          console.log(response);
          
          // Manejar diferentes tipos de respuestas
          switch(response.type) {
            case 'devices':
              console.log('Dispositivos en la red:', response.data);
              
              // Formatear los dispositivos para mostrar
              const formattedDevices = [
                response.data.first_device,
                response.data.last_device
              ];
              
              setNetworkDevices(formattedDevices);
              break;
            
            case 'error':
              console.error('Server error:', response.message);
              break;
            
            default:
              console.warn('Unknown response type:', response);
          }
        } catch (parseError) {
          console.error('Error parsing response:', parseError, 'Raw data:', event.data);
        }
      };
  
      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource.close();
      };
  
      // Opcional: cerrar el event source cuando se desmonte el componente
      return () => {
        eventSource.close();
      };
    } catch (error) {
      console.error('Error setting up device network scan:', error);
    }
  };

  // Network selection handler
  const airoStart = () => {
    if (selectedNetwork) {
      const [ssid, channel, bssid] = selectedNetwork.split(',').map(item => item.trim());
      console.log('Selected Network Details:');
      console.log('SSID:', ssid);
      console.log('Channel:', channel); 
      console.log('BSSID:', bssid);
      
      // Llamar a la función para obtener dispositivos en la red
      fetchDevicesInNetwork(ssid, channel);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-gray-100 min-h-screen">
      <h1 className="text-2xl font-bold mb-6 text-center">WiFi Network Scanner</h1>
      
      <div className="bg-white shadow-md rounded-lg p-6 mb-4">
        <h2 className="text-xl font-semibold mb-4">Device Selection</h2>
        <div className="flex items-center space-x-4">
          <select 
            value={selectedDevice} 
            onChange={(e) => setSelectedDevice(e.target.value)}
            className="flex-grow p-2 border rounded"
          >
            <option value="">Select Network Interface</option>
            {devices.map(device => (
              <option key={device} value={device}>{device}</option>
            ))}
          </select>

          {!monitorInterface ? (
            <button 
              onClick={startMonitor}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Start Monitor
            </button>
          ) : (
            <button 
              onClick={stopMonitor}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
            >
              Stop Monitor
            </button>
          )}
        </div>

        {monitorInterface && (
          <div className="mt-4 text-green-600">
            Monitor Interface: {monitorInterface}
          </div>
        )}
      </div>

      {monitorInterface && (
        <div className="bg-white shadow-md rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Network Scan</h2>
          <div className="flex space-x-4">
            {!scanning ? (
              <button 
                onClick={startScan}
                className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
              >
                Start Scan
              </button>
            ) : (
              <button 
                onClick={stopScan}
                className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
              >
                Stop Scan
              </button>
            )}
          </div>
          {networks.length > 0 && (
            <div className="mt-4">
              <h3 className="text-lg font-semibold mb-2">Detected Networks</h3>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-200">
                    <th className="border p-2 text-left">SSID</th>
                    <th className="border p-2 text-left">Channel</th>
                    <th className="border p-2 text-left">BSSID</th>
                  </tr>
                </thead>
                <tbody>
                  {networks.slice(1).map((network, index) => {
                    const [ssid, channel, bssid] = network.split(',').map(item => item.trim());

                    
                    const validSsid = ssid && ssid !== ''; 
                    const validChannel = channel && !isNaN(channel) && parseInt(channel) > 0; 
                    const validBssid = bssid && bssid !== ''; 

                    if (!validSsid || !validChannel || !validBssid) {
                      return null;
                    }

                    return (
                      <tr 
                        key={index} 
                        className={`hover:bg-gray-100 cursor-pointer ${
                          selectedNetwork === network ? 'bg-blue-100' : ''
                        }`}
                        onClick={() => {
                          setSelectedNetwork(network);
                          airoStart();
                        }}
                      >
                        <td className="border p-2">{ssid}</td>
                        <td className="border p-2">{channel}</td>
                        <td className="border p-2">{bssid}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {selectedNetwork && (
                <div className="mt-4 bg-white p-4 rounded shadow">
                  <h4 className="text-lg font-semibold mb-2">Selected Network</h4>
                  <p><strong>SSID:</strong> {selectedNetwork.split(',')[0].trim()}</p>
                  <p><strong>Channel:</strong> {selectedNetwork.split(',')[1].trim()}</p>
                  <p><strong>BSSID:</strong> {selectedNetwork.split(',')[2].trim()}</p>
                  <button 
                    onClick={airoStart}
                    className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                  >
                    Scan Network Devices
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mostrar dispositivos en la red */}
      {networkDevices.length > 0 && (
        <div className="mt-4 bg-white p-4 rounded shadow">
          <h4 className="text-lg font-semibold mb-2">Devices in Network</h4>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-200">
                <th className="border p-2 text-left">MAC Address</th>
                <th className="border p-2 text-left">IP Address</th>
                <th className="border p-2 text-left">Hostname</th>
                <th className="border p-2 text-left">Vendor</th>
              </tr>
            </thead>
            <tbody>
              {networkDevices.map((device, index) => (
                <tr key={index} className="hover:bg-gray-100">
                  <td className="border p-2">{device.mac}</td>
                  <td className="border p-2">{device.ip || 'N/A'}</td>
                  <td className="border p-2">{device.hostname || 'N/A'}</td>
                  <td className="border p-2">{device.vendor || 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default WifiScanner;




