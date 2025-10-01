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
        
        // Audio output with delay and announcements
        this.audioOutputEnabled = false;
        this.delayBuffer = null;
        this.delayTime = 1.0; // 1 second delay
        this.lastAnnouncedChord = null;
        this.announcementOscillator = null;
        this.announcementGain = null;
        
        this.initializeElements();
        this.loadAudioDevices();
        this.setupEventListeners();
        this.setupVisibilityHandlers();
    }

    restoreLastDevice() {
        const lastInputDeviceId = localStorage.getItem('lastAudioInputDevice');
        const lastOutputDeviceId = localStorage.getItem('lastAudioOutputDevice');
        
        if (lastInputDeviceId) {
            setTimeout(() => {
                this.audioInput.value = lastInputDeviceId;
                if (lastInputDeviceId) {
                    this.startDetection();
                }
            }, 100);
        }
        
        if (lastOutputDeviceId) {
            setTimeout(() => {
                this.audioOutput.value = lastOutputDeviceId;
                if (lastOutputDeviceId && this.isRunning) {
                    this.enableAudioOutput();
                }
            }, 150);
        }
    }

    initializeElements() {
        this.audioInput = document.getElementById('audioInput');
        this.audioOutput = document.getElementById('audioOutput');
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.currentChord = document.getElementById('currentChord');
        this.confidence = document.getElementById('confidence');
        this.bpmDisplay = document.getElementById('bpmDisplay');
        this.ticker = document.getElementById('ticker');
        this.status = document.getElementById('status');
        this.canvas = document.getElementById('waveformCanvas');
        this.canvasContext = this.canvas.getContext('2d');
        this.enableAudioOutputBtn = document.getElementById('enableAudioOutput');
        this.disableAudioOutputBtn = document.getElementById('disableAudioOutput');
        
        // Set canvas dimensions
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    async loadAudioDevices() {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
            const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');
            
            // Load input devices
            audioInputDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Dispositivo de entrada ${audioInputDevices.indexOf(device) + 1}`;
                this.audioInput.appendChild(option);
            });
            
            // Load output devices
            audioOutputDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Dispositivo de salida ${audioOutputDevices.indexOf(device) + 1}`;
                this.audioOutput.appendChild(option);
            });
            
            if (audioInputDevices.length > 0) {
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
        console.log('setupEventListeners: Setting up event listeners');
        
        this.startBtn.addEventListener('click', () => this.startDetection());
        this.stopBtn.addEventListener('click', () => this.stopDetection());
        this.audioInput.addEventListener('change', () => this.onDeviceChange());
        this.audioOutput.addEventListener('change', () => this.onDeviceChange());
        this.enableAudioOutputBtn.addEventListener('click', () => this.enableAudioOutput());
        this.disableAudioOutputBtn.addEventListener('click', () => this.disableAudioOutput());
        
        // Debug event listener for audioOutput
        this.audioOutput.addEventListener('change', (event) => {
            console.log('DEBUG: audioOutput change event fired', event.target.value);
            this.onDeviceChange();
        });
        
        console.log('setupEventListeners: Event listeners set up successfully');
        console.log('audioInput:', this.audioInput);
        console.log('audioOutput:', this.audioOutput);
    }

    setupVisibilityHandlers() {
        // Handle page visibility changes to prevent AudioContext suspension
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden - handling AudioContext suspension');
                this.handlePageHidden();
            } else {
                console.log('Page visible - resuming AudioContext if needed');
                this.handlePageVisible();
            }
        });

        // Handle window focus/blur events
        window.addEventListener('blur', () => {
            console.log('Window lost focus - handling AudioContext suspension');
            this.handlePageHidden();
        });

        window.addEventListener('focus', () => {
            console.log('Window gained focus - resuming AudioContext if needed');
            this.handlePageVisible();
        });
    }

    async handlePageHidden() {
        // When page loses focus, we don't need to do anything special
        // The AudioContext will automatically suspend, but we'll resume it when needed
        console.log('handlePageHidden: Page is hidden');
    }

    async handlePageVisible() {
        // When page becomes visible again, resume AudioContext if it was suspended
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                console.log('handlePageVisible: Resuming suspended AudioContext');
                await this.audioContext.resume();
                console.log('handlePageVisible: AudioContext resumed successfully');
                
                // If audio output was enabled, restart it
                if (this.audioOutputEnabled) {
                    console.log('handlePageVisible: Restarting audio output');
                    setTimeout(() => {
                        this.enableAudioOutput();
                    }, 100);
                }
            } catch (error) {
                console.error('handlePageVisible: Error resuming AudioContext:', error);
            }
        }
    }

    onDeviceChange() {
        const inputDeviceId = this.audioInput.value;
        const outputDeviceId = this.audioOutput.value;
        
        console.log(`onDeviceChange: input=${inputDeviceId}, output=${outputDeviceId}, running=${this.isRunning}, outputEnabled=${this.audioOutputEnabled}`);
        
        // Save the selected devices
        if (inputDeviceId) {
            localStorage.setItem('lastAudioInputDevice', inputDeviceId);
        }
        if (outputDeviceId) {
            localStorage.setItem('lastAudioOutputDevice', outputDeviceId);
        }
        
        // Determine which device triggered the change
        const eventTarget = event ? event.target : null;
        const isOutputChange = eventTarget && eventTarget.id === 'audioOutput';
        
        // Handle input device change (only if input was changed)
        if (!isOutputChange && inputDeviceId && this.isRunning) {
            // If already running and input device changed, restart with new device
            console.log('onDeviceChange: Restarting detection with new input device');
            this.stopDetection();
            setTimeout(() => this.startDetection(), 100);
        } else if (!isOutputChange && inputDeviceId && !this.isRunning) {
            // If not running and input device selected, start automatically
            console.log('onDeviceChange: Starting detection with new input device');
            this.startDetection();
        }
        
        // Handle output device change - SIMPLIFIED LOGIC
        if (outputDeviceId && this.isRunning) {
            // If running and output device selected, enable/restart output
            console.log('onDeviceChange: Enabling/restarting audio output');
            if (this.audioOutputEnabled) {
                // If already enabled, update output device
                console.log('onDeviceChange: Output already enabled, updating device');
                this.updateOutputDevice();
            } else {
                // If not enabled, enable it
                this.enableAudioOutput();
            }
        } else if (!outputDeviceId && this.audioOutputEnabled) {
            // If output device deselected while enabled, disable
            console.log('onDeviceChange: Disabling audio output (device deselected)');
            this.disableAudioOutput();
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
            
            // Configure AudioContext to be more resilient to suspension
            this.audioContext.onstatechange = () => {
                console.log(`AudioContext state changed: ${this.audioContext.state}`);
                if (this.audioContext.state === 'suspended' && this.isRunning) {
                    console.log('AudioContext suspended while running - attempting to resume');
                    setTimeout(() => {
                        if (this.audioContext && this.audioContext.state === 'suspended') {
                            this.audioContext.resume().catch(err => {
                                console.warn('Failed to resume AudioContext:', err);
                            });
                        }
                    }, 100);
                }
            };
            
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
        
        // Clean up audio output resources
        this.disableAudioOutput();
        
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
        this.lastAnnouncedChord = null;
        this.status.textContent = 'Detección detenida';
        this.status.className = 'status';
    }

    processAudio() {
        if (!this.isRunning) return;

        // Check if AudioContext is suspended and try to resume it
        if (this.audioContext && this.audioContext.state === 'suspended') {
            console.log('processAudio: AudioContext is suspended, attempting to resume');
            this.audioContext.resume().then(() => {
                console.log('processAudio: AudioContext resumed successfully');
            }).catch(err => {
                console.warn('processAudio: Failed to resume AudioContext:', err);
            });
        }

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
                    
                    // Play chord announcement if audio output is enabled
                    if (this.audioOutputEnabled) {
                        this.playChordAnnouncement(chord.name);
                    }
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
        // Calculate RMS energy in the audio signal
        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sumSquares / audioData.length);

        // Adaptive threshold - start with very low threshold and adjust dynamically
        let threshold = 0.02; // Very low threshold for maximum sensitivity
        
        // Beat detection with improved logic
        if (rms > threshold && currentTime - this.lastBeatTime > 100) {
            // Detected a beat
            this.lastBeatTime = currentTime;
            this.beatHistory.push(currentTime);
            
            // Keep only recent beats (last 6 seconds for faster adaptation)
            const sixSecondsAgo = currentTime - 6000;
            this.beatHistory = this.beatHistory.filter(time => time > sixSecondsAgo);
            
            // Calculate BPM from beat intervals with improved accuracy
            if (this.beatHistory.length >= 2) {
                const intervals = [];
                for (let i = 1; i < this.beatHistory.length; i++) {
                    intervals.push(this.beatHistory[i] - this.beatHistory[i - 1]);
                }
                
                // Calculate median interval for more robust BPM calculation
                intervals.sort((a, b) => a - b);
                const medianInterval = intervals[Math.floor(intervals.length / 2)];
                
                // Calculate BPM and ensure it's within reasonable range (40-200 BPM)
                const calculatedBPM = Math.round(60000 / medianInterval);
                if (calculatedBPM >= 40 && calculatedBPM <= 200) {
                    this.bpm = calculatedBPM;
                    
                    // Update sample interval based on BPM (sample every beat)
                    this.sampleInterval = 60000 / this.bpm;
                    
                    // Debug logging
                    console.log(`BPM detected: ${this.bpm}, RMS: ${rms.toFixed(4)}, Beats: ${this.beatHistory.length}`);
                }
            }
        }
        
        // If no beats detected for a while, reset to default
        if (currentTime - this.lastBeatTime > 3000 && this.beatHistory.length > 0) {
            this.beatHistory = [];
            this.bpm = 120;
            this.sampleInterval = 0;
            console.log('BPM reset to default 120');
        }
        
        // Debug: show current RMS value occasionally
        if (Math.random() < 0.01) {
            console.log(`Current RMS: ${rms.toFixed(4)}, Threshold: ${threshold}`);
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

    async enableAudioOutput() {
        if (!this.isRunning) {
            console.log('enableAudioOutput: Not running, skipping');
            return; // Silently return if not running
        }

        try {
            console.log('enableAudioOutput: Starting...');
            
            // Get selected output device
            const outputDeviceId = this.audioOutput.value;
            if (!outputDeviceId) {
                console.log('enableAudioOutput: No output device selected');
                this.status.textContent = 'Selecciona un dispositivo de salida primero';
                this.status.className = 'status error';
                return;
            }
            
            // Only create new oscillator if one doesn't exist
            if (!this.announcementOscillator) {
                console.log('enableAudioOutput: Creating new oscillator');
                
                // Create announcement oscillator and gain
                this.announcementOscillator = this.audioContext.createOscillator();
                this.announcementGain = this.audioContext.createGain();
                
                // Configure oscillator
                this.announcementOscillator.type = 'sine';
                this.announcementOscillator.frequency.setValueAtTime(440, this.audioContext.currentTime); // Default A4
                
                // Configure gain - start silent
                this.announcementGain.gain.setValueAtTime(0, this.audioContext.currentTime);
                
                // Connect nodes
                this.announcementOscillator.connect(this.announcementGain);
                
                // Set output device using setSinkId
                try {
                    await this.audioContext.setSinkId(outputDeviceId);
                    console.log('enableAudioOutput: Output device set to:', outputDeviceId);
                } catch (error) {
                    console.warn('enableAudioOutput: setSinkId not supported, using default device:', error);
                }
                
                // Connect to audio context destination (now with correct sink)
                this.announcementGain.connect(this.audioContext.destination);
                
                // Start oscillator (it will be silent until we adjust gain)
                this.announcementOscillator.start();
                console.log('enableAudioOutput: Oscillator started');
            } else {
                console.log('enableAudioOutput: Using existing oscillator');
                
                // Update output device for existing oscillator
                try {
                    await this.audioContext.setSinkId(outputDeviceId);
                    console.log('enableAudioOutput: Updated output device to:', outputDeviceId);
                } catch (error) {
                    console.warn('enableAudioOutput: setSinkId not supported:', error);
                }
            }
            
            this.audioOutputEnabled = true;
            
            // Hide manual buttons since it's now automatic
            this.enableAudioOutputBtn.classList.add('hidden');
            this.disableAudioOutputBtn.classList.add('hidden');
            
            console.log('enableAudioOutput: Successfully enabled');
            this.status.textContent = 'Anuncios de acordes activados automáticamente';
            this.status.className = 'status info';
            
            // Test tone to verify audio is working
            setTimeout(() => {
                if (this.audioOutputEnabled) {
                    console.log('enableAudioOutput: Testing audio with test tone');
                    this.playTestTone();
                }
            }, 500);
            
        } catch (error) {
            console.error('Error enabling audio output:', error);
            this.status.textContent = 'Error al activar anuncios de audio: ' + error.message;
            this.status.className = 'status error';
        }
    }

    playTestTone() {
        if (!this.audioOutputEnabled || !this.announcementOscillator || !this.announcementGain) {
            return;
        }
        
        console.log('playTestTone: Playing test tone');
        
        const now = this.audioContext.currentTime;
        this.announcementOscillator.frequency.setValueAtTime(440, now); // A4
        this.announcementGain.gain.cancelScheduledValues(now);
        this.announcementGain.gain.setValueAtTime(0.3, now);
        this.announcementGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4); // Fade out over 0.4 seconds
        this.announcementGain.gain.linearRampToValueAtTime(0, now + 0.5); // Ensure complete silence at 0.5 seconds
    }

    async updateOutputDevice() {
        if (!this.audioOutputEnabled || !this.audioContext) {
            return;
        }
        
        const outputDeviceId = this.audioOutput.value;
        if (!outputDeviceId) {
            return;
        }
        
        try {
            await this.audioContext.setSinkId(outputDeviceId);
            console.log('updateOutputDevice: Output device updated to:', outputDeviceId);
            
            // Test tone to verify audio is working on new device
            setTimeout(() => {
                if (this.audioOutputEnabled) {
                    console.log('updateOutputDevice: Testing audio with test tone');
                    this.playTestTone();
                }
            }, 100);
        } catch (error) {
            console.warn('updateOutputDevice: setSinkId not supported:', error);
        }
    }

    disableAudioOutput() {
        if (this.audioOutputEnabled) {
            console.log('disableAudioOutput: Disabling audio output');
            
            // Silencia el oscilador en lugar de detenerlo
            if (this.announcementGain) {
                this.announcementGain.gain.cancelScheduledValues(this.audioContext.currentTime);
                this.announcementGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            }
            
            this.audioOutputEnabled = false;
            this.lastAnnouncedChord = null;
            
            // Hide manual buttons since it's now automatic
            this.enableAudioOutputBtn.classList.add('hidden');
            this.disableAudioOutputBtn.classList.add('hidden');
            
            this.status.textContent = 'Anuncios de acordes desactivados';
            this.status.className = 'status';
        }
    }

    playChordAnnouncement(chordName) {
        if (!this.audioOutputEnabled || !this.announcementOscillator || !this.announcementGain) {
            console.log(`playChordAnnouncement: Not ready - enabled: ${this.audioOutputEnabled}, osc: ${!!this.announcementOscillator}, gain: ${!!this.announcementGain}`);
            return;
        }

        // Only announce if chord changed
        if (this.lastAnnouncedChord === chordName) {
            console.log(`playChordAnnouncement: Chord ${chordName} same as last, skipping`);
            return;
        }

        this.lastAnnouncedChord = chordName;

        // Map chord to frequency for announcement tone
        const noteFrequencies = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
            'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88,
            'Cm': 261.63, 'C#m': 277.18, 'Dm': 293.66, 'D#m': 311.13,
            'Em': 329.63, 'Fm': 349.23, 'F#m': 369.99, 'Gm': 392.00,
            'G#m': 415.30, 'Am': 440.00, 'A#m': 466.16, 'Bm': 493.88
        };

        const frequency = noteFrequencies[chordName] || 440;
        
        console.log(`playChordAnnouncement: Playing chord ${chordName} at frequency ${frequency}Hz`);
        
        // Set oscillator type and frequency
        this.announcementOscillator.type = 'sine';
        this.announcementOscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        
        // Create a short beep sound (0.3 seconds) with clean fade-out
        const now = this.audioContext.currentTime;
        this.announcementGain.gain.cancelScheduledValues(now); // Cancel any previous schedules
        this.announcementGain.gain.setValueAtTime(0.5, now); // Start at 50% volume
        this.announcementGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25); // Fade out over 0.25 seconds
        this.announcementGain.gain.linearRampToValueAtTime(0, now + 0.3); // Ensure complete silence at 0.3 seconds
    }
}

// Initialize the chord detector when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChordDetector();
});