class ChordDetector {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.stream = null;
        this.isRunning = false;
        this.animationId = null;
        
        // BPM detection variables
        this.beatHistory = [];
        this.lastBeatTime = 0;
        this.bpm = 120; // Default BPM
        this.sampleInterval = 0;
        this.lastSampleTime = 0;
        
        // Ticker variables
        this.lastChord = null;
        this.tickerItems = [];
        this.maxTickerItems = 15;
        
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
        this.bpmDisplay = document.getElementById('bpmDisplay');
        this.ticker = document.getElementById('ticker');
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
        this.bpmDisplay.textContent = 'BPM: --';
        this.ticker.innerHTML = '';
        this.tickerItems = [];
        this.lastChord = null;
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

        // Detect BPM and sample at appropriate intervals
        const currentTime = performance.now();
        this.detectBPM(dataArray, currentTime);

        // Update BPM display
        this.bpmDisplay.textContent = `BPM: ${this.bpm}`;

        // Sample audio based on BPM intervals
        if (this.shouldSample(currentTime)) {
            const chord = this.detectChord(dataArray);
            
            if (chord) {
                this.currentChord.textContent = chord.name;
                this.confidence.textContent = `Confianza: ${Math.round(chord.confidence * 100)}%`;
                
                // Add to ticker only if chord changed
                if (this.lastChord !== chord.name) {
                    this.addToTicker(chord.name);
                    this.lastChord = chord.name;
                } else {
                    // Add empty space when chord doesn't change
                    this.addToTicker(null);
                }
            } else {
                this.currentChord.textContent = '--';
                this.confidence.textContent = 'Confianza: 0%';
                this.lastChord = null;
                // Add empty space when no chord detected
                this.addToTicker(null);
            }
        }

        this.animationId = requestAnimationFrame(() => this.processAudio());
    }

    addToTicker(chordName) {
        // Add new item to ticker (note or empty space)
        this.tickerItems.push({
            chord: chordName,
            timestamp: new Date().toLocaleTimeString()
        });
        
        // Limit the number of items (keep the most recent ones)
        if (this.tickerItems.length > this.maxTickerItems) {
            this.tickerItems = this.tickerItems.slice(-this.maxTickerItems);
        }
        
        // Update ticker display
        this.updateTicker();
    }

    updateTicker() {
        const tickerHTML = this.tickerItems.map(item => {
            if (item.chord) {
                return `<span class="ticker-item">${item.chord}</span>`;
            } else {
                return `<span class="ticker-empty">•</span>`;
            }
        }).join('');
        
        this.ticker.innerHTML = tickerHTML;
    }

    detectBPM(audioData, currentTime) {
        // Calculate energy in the audio signal
        let energy = 0;
        for (let i = 0; i < audioData.length; i++) {
            energy += Math.abs(audioData[i]);
        }
        energy /= audioData.length;

        // Simple beat detection based on energy threshold
        const threshold = 0.1; // Adjust based on audio levels
        if (energy > threshold && currentTime - this.lastBeatTime > 200) {
            // Detected a beat
            this.lastBeatTime = currentTime;
            this.beatHistory.push(currentTime);
            
            // Keep only recent beats (last 10 seconds)
            const tenSecondsAgo = currentTime - 10000;
            this.beatHistory = this.beatHistory.filter(time => time > tenSecondsAgo);
            
            // Calculate BPM from beat intervals
            if (this.beatHistory.length > 2) {
                const intervals = [];
                for (let i = 1; i < this.beatHistory.length; i++) {
                    intervals.push(this.beatHistory[i] - this.beatHistory[i - 1]);
                }
                
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                this.bpm = Math.round(60000 / avgInterval);
                
                // Update sample interval based on BPM (sample every beat)
                this.sampleInterval = 60000 / this.bpm;
            }
        }
    }

    shouldSample(currentTime) {
        if (this.sampleInterval === 0) {
            // If no BPM detected yet, sample every 500ms
            if (currentTime - this.lastSampleTime > 500) {
                this.lastSampleTime = currentTime;
                return true;
            }
            return false;
        }
        
        // Sample based on BPM interval
        if (currentTime - this.lastSampleTime > this.sampleInterval) {
            this.lastSampleTime = currentTime;
            return true;
        }
        return false;
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
        // Use both time domain and frequency domain analysis
        const bufferLength = this.analyser.frequencyBinCount;
        const frequencyData = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(frequencyData);
        
        // Find fundamental frequencies using harmonic analysis
        const fundamentals = this.findFundamentalFrequencies(frequencyData);
        
        // Convert frequencies to notes with octave information
        const notesWithOctaves = fundamentals.map(freq => this.frequencyToNoteWithOctave(freq));
        
        // Enhanced chord detection with harmonic analysis
        return this.identifyChordWithHarmonics(notesWithOctaves, fundamentals);
    }

    findFundamentalFrequencies(frequencyData) {
        const peaks = [];
        const sampleRate = this.audioContext.sampleRate;
        const bufferLength = frequencyData.length;
        
        // Find all local maxima
        for (let i = 2; i < bufferLength - 2; i++) {
            const current = frequencyData[i];
            const prev1 = frequencyData[i - 1];
            const prev2 = frequencyData[i - 2];
            const next1 = frequencyData[i + 1];
            const next2 = frequencyData[i + 2];
            
            // Check if this is a local maximum with sufficient prominence
            if (current > prev1 && current > next1 &&
                current > prev2 && current > next2 &&
                current > 64) { // Lower threshold for more sensitivity
                
                const frequency = i * sampleRate / (bufferLength * 2);
                if (frequency > 65 && frequency < 1000) { // Extended range for fundamentals
                    peaks.push({
                        frequency: frequency,
                        amplitude: current,
                        bin: i
                    });
                }
            }
        }
        
        // Sort by amplitude and filter harmonics
        peaks.sort((a, b) => b.amplitude - a.amplitude);
        const fundamentals = [];
        
        for (let i = 0; i < peaks.length && fundamentals.length < 4; i++) {
            const peak = peaks[i];
            let isHarmonic = false;
            
            // Check if this peak is a harmonic of an existing fundamental
            for (let j = 0; j < fundamentals.length; j++) {
                const fundamental = fundamentals[j];
                const ratio = peak.frequency / fundamental.frequency;
                
                // Check if this is approximately a harmonic (2x, 3x, 4x, etc.)
                if (Math.abs(ratio - Math.round(ratio)) < 0.05) {
                    isHarmonic = true;
                    break;
                }
            }
            
            if (!isHarmonic) {
                fundamentals.push(peak);
            }
        }
        
        return fundamentals.map(peak => peak.frequency);
    }

    frequencyToNoteWithOctave(frequency) {
        const A4 = 440;
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        
        const noteNumber = 12 * (Math.log2(frequency / A4));
        const noteIndex = Math.round(noteNumber) % 12;
        const octave = Math.floor(noteNumber / 12) + 4;
        
        return {
            note: noteNames[(noteIndex + 12) % 12],
            octave: octave
        };
    }

    identifyChordWithHarmonics(notesWithOctaves, frequencies) {
        if (notesWithOctaves.length < 2) return null;
        
        // Extract just the note names for chord matching
        const noteNames = notesWithOctaves.map(n => n.note);
        const uniqueNotes = [...new Set(noteNames)].sort();
        
        // Enhanced chord patterns with better confidence calculation
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
            'B,D,F#': { name: 'Bm', confidence: 0.8 }
        };
        
        const noteString = uniqueNotes.join(',');
        
        if (chordPatterns[noteString]) {
            return chordPatterns[noteString];
        }
        
        // Try partial matches (2 out of 3 notes)
        if (uniqueNotes.length >= 2) {
            for (const pattern in chordPatterns) {
                const patternNotes = pattern.split(',');
                const matchingNotes = uniqueNotes.filter(note => patternNotes.includes(note));
                
                if (matchingNotes.length >= 2) {
                    return {
                        name: chordPatterns[pattern].name,
                        confidence: chordPatterns[pattern].confidence * 0.7
                    };
                }
            }
        }
        
        // Fallback: return most prominent note
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