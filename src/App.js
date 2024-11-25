import React, { useState, useEffect } from 'react';
import axios from 'axios';

const App = () => {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [networks, setNetworks] = useState([]);
  const [output, setOutput] = useState('');
  const [monitorMode, setMonitorMode] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDevices();
  }, []);

  // Efecto para actualizar las redes en tiempo real
  useEffect(() => {
    let intervalId;
    if (isScanning) {
      // Hacer polling cada segundo para obtener nuevas redes
      intervalId = setInterval(fetchNetworks, 1000);
    }
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isScanning]);

  const fetchDevices = async () => {
    try {
      const response = await axios.get('http://localhost:5000/list-devices');
      setDevices(response.data.devices || []);
    } catch (error) {
      setError('Error fetching devices');
      console.error('Error:', error);
    }
  };

  const fetchNetworks = async () => {
    try {
      const response = await axios.get('http://localhost:5000/get-networks');
      setNetworks(response.data.networks || []);
    } catch (error) {
      console.error('Error fetching networks:', error);
    }
  };

  const handleStartMonitor = async () => {
    if (!selectedDevice) {
      setError('Please select a device');
      return;
    }
    try {
      const response = await axios.post('http://localhost:5000/start-monitor', {
        interface: selectedDevice
      });
      setMonitorMode(true);
      setOutput(response.data.output || 'Monitor mode activated');
      setError('');
    } catch (error) {
      setError('Error activating monitor mode');
      console.error('Error:', error);
    }
  };

  const handleStopMonitor = async () => {
    try {
      const response = await axios.post('http://localhost:5000/stop-monitor', {
        interface: selectedDevice
      });
      setMonitorMode(false);
      setIsScanning(false);
      setNetworks([]);
      setOutput(response.data.output || 'Monitor mode deactivated');
      setError('');
    } catch (error) {
      setError('Error deactivating monitor mode');
      console.error('Error:', error);
    }
  };

  const handleStartScan = async () => {
    try {
      await axios.post('http://localhost:5000/scan-networks', {
        interface: selectedDevice
      });
      setIsScanning(true);
      setError('');
    } catch (error) {
      setError('Error starting network scan');
      console.error('Error:', error);
    }
  };

  const handleStopScan = async () => {
    try {
      await axios.post('http://localhost:5000/stop-scan');
      setIsScanning(false);
      setNetworks([]);
      setError('');
    } catch (error) {
      setError('Error stopping network scan');
      console.error('Error:', error);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">WiFi Network Scanner</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="mb-6">
        <label className="block text-lg font-semibold mb-2">Select Network Interface</label>
        <select
          className="w-full p-2 border rounded shadow-sm"
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
        >
          <option value="">Select an interface</option>
          {devices.map((device, index) => (
            <option key={index} value={device}>{device}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-4 mb-6">
        <button
          className={`px-4 py-2 rounded font-semibold ${
            monitorMode ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'
          } text-white`}
          onClick={handleStartMonitor}
          disabled={monitorMode}
        >
          Enable Monitor Mode
        </button>
        <button
          className={`px-4 py-2 rounded font-semibold ${
            !monitorMode ? 'bg-gray-400' : 'bg-red-500 hover:bg-red-600'
          } text-white`}
          onClick={handleStopMonitor}
          disabled={!monitorMode}
        >
          Disable Monitor Mode
        </button>
      </div>

      {monitorMode && (
        <div className="mb-6">
          <div className="flex gap-4">
            <button
              className={`px-4 py-2 rounded font-semibold ${
                isScanning ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
              } text-white`}
              onClick={handleStartScan}
              disabled={isScanning}
            >
              Start Scanning
            </button>
            <button
              className={`px-4 py-2 rounded font-semibold ${
                !isScanning ? 'bg-gray-400' : 'bg-yellow-500 hover:bg-yellow-600'
              } text-white`}
              onClick={handleStopScan}
              disabled={!isScanning}
            >
              Stop Scanning
            </button>
          </div>
        </div>
      )}

      {networks.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-4">Detected Networks</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white border rounded-lg">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-6 py-3 border-b text-left">BSSID</th>
                  <th className="px-6 py-3 border-b text-left">Power</th>
                  <th className="px-6 py-3 border-b text-left">Channel</th>
                  <th className="px-6 py-3 border-b text-left">Encryption</th>
                  <th className="px-6 py-3 border-b text-left">ESSID</th>
                </tr>
              </thead>
              <tbody>
                {networks.map((network, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 border-b">{network.bssid}</td>
                    <td className="px-6 py-4 border-b">{network.power} dBm</td>
                    <td className="px-6 py-4 border-b">{network.channel}</td>
                    <td className="px-6 py-4 border-b">{network.encryption}</td>
                    <td className="px-6 py-4 border-b">{network.essid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {output && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-2">Output</h2>
          <pre className="bg-gray-100 p-4 rounded overflow-x-auto">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
};

export default App;