'use client'

import { useState, useEffect } from 'react'

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState('42:23')
  const [waveformData, setWaveformData] = useState<number[]>([])

  // Generate random waveform data
  useEffect(() => {
    const generateWaveform = () => {
      const data = Array.from({ length: 120 }, () => Math.random() * 100)
      setWaveformData(data)
    }

    generateWaveform()
    const interval = setInterval(generateWaveform, 1000)

    return () => clearInterval(interval)
  }, [])

  const sessions = [
    { name: 'Afternoon Sync with Product Team', date: '2:30 PM', duration: '45:12' },
    { name: 'Solo Brainstorming', date: '11:15 AM', duration: '28:45' },
    { name: 'Client Interview - Sarah Chen', date: 'Yesterday', duration: '1:12:33' },
    { name: 'Feature Planning Discussion', date: 'Yesterday', duration: '33:21' },
    { name: 'User Research Insights', date: '2 days ago', duration: '52:18' },
  ]

  return (
    <div className="min-h-screen bg-dark flex">
      {/* Sidebar - Session History */}
      <div className="w-80 bg-gray-850 p-6 border-r border-gray-750">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Sessions</h2>
          <div className="space-y-3">
            {sessions.map((session, index) => (
              <div key={index} className="session-item">
                <div className="font-medium text-white mb-1 text-sm">{session.name}</div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-xs">{session.date}</span>
                  <span className="text-gray-300 text-xs font-mono">{session.duration}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-750 pt-4">
          <button className="w-full py-2 px-4 bg-accent text-dark font-medium rounded-lg hover:bg-accent-dim transition-colors">
            New Recording
          </button>
        </div>
      </div>

      {/* Main Recording Interface */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-gray-850 px-8 py-6 border-b border-gray-750">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <img
                src="https://static.scribemd.ai/assets/prod/logo-white-924baac46e034a61b17f39df1ffa86eea23200f5b52b1b5b988c5f581eec26ca.png"
                alt="ScribeMD"
                className="h-8 w-auto"
              />
              <span className="text-xl font-bold text-white">Sonic Monolith</span>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-400">
                Professional Audio Recording
              </div>
            </div>
          </div>
        </div>

        {/* Recording Status */}
        <div className="bg-gray-850 px-8 py-4 border-b border-gray-750">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="recording-dot"></div>
              <span className="text-lg font-mono text-white">{duration}</span>
              <span className="text-sm text-gray-400">24-bit • 48kHz • WAV</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="text-sm text-gray-400">Level:</div>
              <div className="flex space-x-1">
                <div className="w-2 h-4 bg-accent rounded-sm"></div>
                <div className="w-2 h-4 bg-accent rounded-sm"></div>
                <div className="w-2 h-4 bg-accent rounded-sm"></div>
                <div className="w-2 h-4 bg-yellow-400 rounded-sm"></div>
                <div className="w-2 h-4 bg-gray-600 rounded-sm"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Waveform Display */}
        <div className="flex-1 bg-dark-lighter p-8">
          <div className="bg-dark rounded-lg p-6 h-full flex items-center justify-center">
            <div className="flex items-end space-x-1 h-32">
              {waveformData.map((height, index) => (
                <div
                  key={index}
                  className="waveform-bar w-1 rounded-sm"
                  style={{ height: `${Math.max(height * 0.8, 4)}px` }}
                ></div>
              ))}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-gray-850 px-8 py-6 border-t border-gray-750">
          <div className="flex items-center justify-center space-x-6">
            <button className="control-button">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
              </svg>
            </button>

            <button
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
                isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-dim'
              }`}
              onClick={() => setIsRecording(!isRecording)}
            >
              {isRecording ? (
                <div className="w-6 h-6 bg-white rounded-sm"></div>
              ) : (
                <svg className="w-8 h-8 text-dark" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              )}
            </button>

            <button className="control-button">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 012 0v6a1 1 0 11-2 0V7zM12 7a1 1 0 012 0v6a1 1 0 11-2 0V7z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          <div className="flex justify-center mt-4 space-x-8 text-sm text-gray-400">
            <span>⌘+R Record</span>
            <span>⌘+S Save</span>
            <span>⌘+E Export</span>
          </div>
        </div>
      </div>
    </div>
  )
}