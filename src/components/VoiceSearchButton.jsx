import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, Square } from 'lucide-react'

export function VoiceSearchButton({ onTranscript, onError, className = '', label = 'Voice search' }) {
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const liveRef = useRef(true)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)

  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.onstop = null
        recorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const toggle = async () => {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      streamRef.current = stream
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data)
      recorder.onstop = async () => {
        if (liveRef.current) setRecording(false)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (liveRef.current) setTranscribing(true)
        try {
          const form = new FormData()
          form.append('audio_file', new Blob(chunksRef.current, { type: recorder.mimeType }), 'voice.webm')
          const response = await fetch('/stt/asr?task=transcribe&output=json', { method: 'POST', body: form })
          if (!response.ok) throw new Error('Transcription failed')
          const result = await response.json()
          if (liveRef.current && result.text) onTranscript?.(String(result.text).trim())
        } catch (error) {
          if (liveRef.current) onError?.(error.message || 'Voice transcription failed.')
        } finally {
          recorderRef.current = null
          if (liveRef.current) setTranscribing(false)
        }
      }
      recorder.start()
      setRecording(true)
    } catch (error) {
      onError?.(error?.name === 'NotAllowedError' ? 'Microphone access was not allowed.' : 'The microphone is unavailable.')
    }
  }

  return (
    <button
      type="button"
      className={className + ' service-voice-button ' + (recording ? 'recording' : '')}
      onClick={() => void toggle()}
      aria-label={recording ? 'Stop recording' : label}
      title={recording ? 'Stop recording' : label}
      disabled={transcribing}
    >
      {transcribing ? <LoaderCircle className="spin" /> : recording ? <Square /> : <Mic />}
    </button>
  )
}
