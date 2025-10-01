class ChordDetector {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.stream = null;
        this.isRunning = false;
        this.animationId = null;
        
        this.initializeElements();
        this.loadAudioDevices();
        this.setupEventListeners();
    }

    restoreLastDevice() {
        const lastDeviceId = localStorage.getItem('lastAudioDevice');
        if (lastDeviceId) {
            setTimeout(() => {
                this.audioInput.value = lastDeviceId;
                if (lastDeviceId) {
                    this.startDetection();
                }
            }, 100);
        }
    }

    initializeElements() {
        this.audioInput = document.getElementById('audioInput');
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.currentChord = document.getElementById('currentChord');
        this.confidence = document.getElementById('confidence');
        this.status = document.getElementById('status');
        this.canvas = document.getElementById('waveformCanvas');
        this.canvasContext = this.canvas.getContext('2d');
        
        // Set canvas dimensions
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    async loadAudioDevices() {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices = devices.filter(device => device.kind === 'audioinput');
            
            audioDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Dispositivo de audio ${audioDevices.indexOf(device) + 1}`;
                this.audioInput.appendChild(option);
            });
            
            if (audioDevices.length > 0) {
                this.status.textContent = 'Dispositivos de audio cargados. Selecciona uno para iniciar la detección automática';
                // Restore last device after devices are loaded
                this.restoreLastDevice();
            } else {
                this.status.textContent = 'No se encontraron dispositivos de audio. Verifica que tengas un micrófono conectado.';
                this.status.className = 'status error';
            }
        } catch (error) {
            console.error('Error loading audio devices:', error);
            this.status.textContent = 'Error al cargar dispositivos de audio: ' + error.message;
            this.status.className = 'status error';
        }
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.startDetection());
        this.stopBtn.addEventListener('click', () => this.stopDetection());
        this.audioInput.addEventListener('change', () => this.onDeviceChange());
    }

    onDeviceChange() {
        const deviceId = this.audioInput.value;
        // Save the selected device
        if (deviceId) {
            localStorage.setItem('lastAudioDevice', deviceId);
        }
        
        if (deviceId && this.isRunning) {
            // If already running and device changed, restart with new device
            this.stopDetection();
            setTimeout(() => this.startDetection(), 100);
        } else if (deviceId && !this.isRunning) {
            // If not running and device selected, start automatically
            this.startDetection();
        }
    }

    async startDetection() {
        const deviceId = this.audioInput.value;
        
        if (!deviceId) {
            this.status.textContent = 'Por favor selecciona un dispositivo de audio';
            this.status.className = 'status error';
            return;
        }

        try {
            this.status.textContent = 'Iniciando captura de audio...';
            this.status.className = 'status info';

            const constraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            
            this.source = this.audioContext.createMediaStreamSource(this.stream);
            this.source.connect(this.analyser);
            
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.8;
            
            this.isRunning = true;
            this.startBtn.classList.add('hidden');
            this.stopBtn.classList.remove('hidden');
            this.status.textContent = 'Detección activa. Tocando música...';
            this.status.className = 'status info';
            
            this.processAudio();
            
        } catch (error) {
            console.error('Error starting audio capture:', error);
            this.status.textContent = 'Error al iniciar la captura de audio: ' + error.message;
            this.status.className = 'status error';
        }
    }

    stopDetection() {
        this.isRunning = false;
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.startBtn.classList.remove('hidden');
        this.stopBtn.classList.add('hidden');
        this.currentChord.textContent = '--';
        this.confidence.textContent = 'Confianza: 0%';
        this.status.textContent = 'Detección detenida';
        this.status.className = 'status';
    }

    processAudio() {
        if (!this.isRunning) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        this.analyser.getFloatTimeDomainData(dataArray);

        // Draw waveform visualization
        this.drawWaveform(dataArray);

        const chord = this.detectChord(dataArray);
        
        if (chord) {
            this.currentChord.textContent = chord.name;
            this.confidence.textContent = `Confianza: ${Math.round(chord.confidence * 100)}%`;
        } else {
            this.currentChord.textContent = '--';
            this.confidence.textContent = 'Confianza: 0%';
        }

        this.animationId = requestAnimationFrame(() => this.processAudio());
    }

    drawWaveform(dataArray) {
        const canvas = this.canvas;
        const ctx = this.canvasContext;
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);

        // Draw waveform with more amplitude
        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#4ecdc4';
        
        const sliceWidth = width / dataArray.length;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const v = dataArray[i] * 18.0; // Reduced by 10% from 20.0
            const y = (v * height / 2) + height / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.stroke();

        // Draw center line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
    }

    detectChord(audioData) {
        // Use the Web Audio API's built-in FFT for better frequency analysis
        const bufferLength = this.analyser.frequencyBinCount;
        const frequencyData = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(frequencyData);
        
        // Find prominent frequencies (peaks) with better algorithm
        const peaks = this.findProminentFrequencies(frequencyData);
        
        // Convert frequencies to notes
        const notes = peaks.map(freq => this.frequencyToNote(freq));
        
        // Enhanced chord detection
        return this.identifyChord(notes);
    }

    findProminentFrequencies(frequencyData) {
        const peaks = [];
        const sampleRate = this.audioContext.sampleRate;
        const bufferLength = frequencyData.length;
        
        // Find local maxima in frequency spectrum
        for (let i = 1; i < bufferLength - 1; i++) {
            const current = frequencyData[i];
            const prev = frequencyData[i - 1];
            const next = frequencyData[i + 1];
            
            // Check if this is a local maximum and above threshold
            if (current > prev && current > next && current > 128) {
                const frequency = i * sampleRate / (bufferLength * 2);
                if (frequency > 80 && frequency < 1000) { // Filter reasonable frequency range
                    peaks.push({
                        frequency: frequency,
                        amplitude: current
                    });
                }
            }
        }
        
        // Sort by amplitude and take top frequencies
        peaks.sort((a, b) => b.amplitude - a.amplitude);
        return peaks.slice(0, 6).map(peak => peak.frequency);
    }

    frequencyToNote(frequency) {
        const A4 = 440;
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        
        const noteNumber = 12 * (Math.log2(frequency / A4));
        const noteIndex = Math.round(noteNumber) % 12;
        return noteNames[(noteIndex + 12) % 12];
    }

    identifyChord(notes) {
        if (notes.length < 2) return null;
        
        // Remove duplicates and sort
        const uniqueNotes = [...new Set(notes)].sort();
        
        // Enhanced chord patterns with more chords
        const chordPatterns = {
            // Major chords
            'C,E,G': { name: 'C', confidence: 0.9 },
            'C#,F,G#': { name: 'C#', confidence: 0.9 },
            'D,F#,A': { name: 'D', confidence: 0.9 },
            'D#,G,A#': { name: 'D#', confidence: 0.9 },
            'E,G#,B': { name: 'E', confidence: 0.9 },
            'F,A,C': { name: 'F', confidence: 0.9 },
            'F#,A#,C#': { name: 'F#', confidence: 0.9 },
            'G,B,D': { name: 'G', confidence: 0.9 },
            'G#,C,D#': { name: 'G#', confidence: 0.9 },
            'A,C#,E': { name: 'A', confidence: 0.9 },
            'A#,D,F': { name: 'A#', confidence: 0.9 },
            'B,D#,F#': { name: 'B', confidence: 0.9 },
            
            // Minor chords
            'C,Eb,G': { name: 'Cm', confidence: 0.8 },
            'C#,E,G#': { name: 'C#m', confidence: 0.8 },
            'D,F,A': { name: 'Dm', confidence: 0.8 },
            'D#,F#,A#': { name: 'D#m', confidence: 0.8 },
            'E,G,B': { name: 'Em', confidence: 0.8 },
            'F,Ab,C': { name: 'Fm', confidence: 0.8 },
            'F#,A,C#': { name: 'F#m', confidence: 0.8 },
            'G,Bb,D': { name: 'Gm', confidence: 0.8 },
            'G#,B,D#': { name: 'G#m', confidence: 0.8 },
            'A,C,E': { name: 'Am', confidence: 0.8 },
            'A#,C#,F': { name: 'A#m', confidence: 0.8 },
            'B,D,F#': { name: 'Bm', confidence: 0.8 },
            
            // 7th chords
            'C,E,G,Bb': { name: 'C7', confidence: 0.7 },
            'D,F#,A,C': { name: 'D7', confidence: 0.7 },
            'E,G#,B,D': { name: 'E7', confidence: 0.7 },
            'F,A,C,Eb': { name: 'F7', confidence: 0.7 },
            'G,B,D,F': { name: 'G7', confidence: 0.7 },
            'A,C#,E,G': { name: 'A7', confidence: 0.7 },
            'B,D#,F#,A': { name: 'B7', confidence: 0.7 },
            
            // Major 7th chords
            'C,E,G,B': { name: 'Cmaj7', confidence: 0.7 },
            'D,F#,A,C#': { name: 'Dmaj7', confidence: 0.7 },
            'E,G#,B,D#': { name: 'Emaj7', confidence: 0.7 },
            'F,A,C,E': { name: 'Fmaj7', confidence: 0.7 },
            'G,B,D,F#': { name: 'Gmaj7', confidence: 0.7 },
            'A,C#,E,G#': { name: 'Amaj7', confidence: 0.7 },
            'B,D#,F#,A#': { name: 'Bmaj7', confidence: 0.7 }
        };
        
        const noteString = uniqueNotes.join(',');
        
        if (chordPatterns[noteString]) {
            return chordPatterns[noteString];
        }
        
        // Try to match with 3-note combinations if we have more notes
        if (uniqueNotes.length > 3) {
            for (let i = 0; i < uniqueNotes.length; i++) {
                for (let j = i + 1; j < uniqueNotes.length; j++) {
                    for (let k = j + 1; k < uniqueNotes.length; k++) {
                        const threeNotes = [uniqueNotes[i], uniqueNotes[j], uniqueNotes[k]].sort();
                        const threeNoteString = threeNotes.join(',');
                        if (chordPatterns[threeNoteString]) {
                            return chordPatterns[threeNoteString];
                        }
                    }
                }
            }
        }
        
        // Fallback: return first note as major chord
        return {
            name: uniqueNotes[0],
            confidence: 0.3
        };
    }
}

// Initialize the chord detector when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChordDetector();
});