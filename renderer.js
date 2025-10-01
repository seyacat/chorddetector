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
        this.chordTimestamps = new Map(); // Track when chords were detected
        this.lastDetectionTime = 0; // Track when chord was detected
        this.playingChords = new Map(); // Track chords currently playing (red highlight)
        
        // Chord buffer for 2-second delay synchronization
        this.chordBuffer = [];
        this.maxBufferSize = 10;
        this.currentDisplayedChord = null;
        
        // Audio output with delay and announcements
        this.audioOutputEnabled = false;
        this.delayBuffer = null;
        this.delayTime = 2.0; // 2 second delay
        this.lastAnnouncedChord = null;
        this.announcementOscillator = null;
        this.announcementGain = null;
        this.delayNode = null;
        this.delayGain = null;
        
        // Improved detection variables
        this.previousSpectrum = null;
        this.onsetThreshold = 0.1;
        this.noiseFloor = 0.01;
        this.frameHistory = [];
        this.maxFrameHistory = 8;
        this.adaptiveThreshold = 0.02;
        this.spectralFluxHistory = [];
        this.lastOnsetTime = 0;
        
        // New improved chord detector
        this.improvedDetector = null;
        
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
        this.detectedNotes = document.getElementById('detectedNotes');
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
            
            // Initialize improved chord detector
            this.improvedDetector = new ImprovedChordDetector(this);
            
            this.isRunning = true;
            this.startBtn.classList.add('hidden');
            this.stopBtn.classList.remove('hidden');
            this.status.textContent = 'Detección activa. Tocando música...';
            this.status.className = 'status info';
            
            // If audio output was previously enabled, re-enable it
            if (this.audioOutputEnabled) {
                setTimeout(() => {
                    this.enableAudioOutput();
                }, 500);
            }
            
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
                // Store chord in buffer with timestamp for 2-second delay synchronization
                this.addChordToBuffer(chord, currentTime);
                
                // Update display with chord that should be playing now (after 2-second delay)
                this.updateDisplayWithDelayedChord(currentTime);
                
                // Add to ticker only if chord changed
                if (this.lastChord !== chord.name) {
                    this.addToTicker(chord.name);
                    this.lastChord = chord.name;
                    this.lastDetectionTime = currentTime;
                    
                    // Play chord announcement if audio output is enabled
                    if (this.audioOutputEnabled) {
                        this.playChordAnnouncement(chord.name, currentTime);
                    }
                } else {
                    // Add empty space when chord doesn't change
                    this.addToTicker(null);
                }
            } else {
                // No chord detected - clear display
                this.currentChord.textContent = '--';
                this.detectedNotes.textContent = 'Notas: --';
                this.confidence.textContent = 'Confianza: 0%';
                this.lastChord = null;
                // Add empty space when no chord detected
                this.addToTicker(null);
            }
        } else {
            // Update display with delayed chord even when not sampling
            this.updateDisplayWithDelayedChord(currentTime);
        }

        // Update ticker colors based on timing
        this.updateTicker();
        
        this.animationId = requestAnimationFrame(() => this.processAudio());
    }

    addToTicker(chordName) {
        const currentTime = Date.now();
        
        // Add new item to ticker (note or empty space)
        this.tickerItems.push({
            chord: chordName,
            timestamp: new Date().toLocaleTimeString(),
            detectionTime: currentTime
        });
        
        // Store detection time for chord timing
        if (chordName) {
            this.chordTimestamps.set(chordName, currentTime);
        }
        
        // Limit the number of items (keep the most recent ones)
        if (this.tickerItems.length > this.maxTickerItems) {
            this.tickerItems = this.tickerItems.slice(-this.maxTickerItems);
        }
        
        // Update ticker display
        this.updateTicker();
    }

    updateTicker() {
        const currentTime = Date.now();
        const tickerHTML = this.tickerItems.map(item => {
            if (item.chord) {
                // Check if chord has been playing for more than 1 second
                const timeSinceDetection = currentTime - item.detectionTime;
                const hasPlayed = timeSinceDetection > 2000; // 2 second delay
                
                // Check if chord is currently playing (red highlight for 0.5 seconds)
                const isPlaying = this.playingChords.has(item.chord) &&
                                 currentTime - this.playingChords.get(item.chord) < 500;
                
                let className;
                if (isPlaying) {
                    className = 'ticker-item playing';
                } else if (hasPlayed) {
                    className = 'ticker-item played';
                } else {
                    className = 'ticker-item upcoming';
                }
                
                return `<span class="${className}">${item.chord}</span>`;
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

        // Very low threshold for studio audio - maximum sensitivity
        let threshold = 0.005; // Much lower threshold for studio recordings
        
        // Beat detection with improved logic
        if (rms > threshold && currentTime - this.lastBeatTime > 80) { // Shorter cooldown
            // Detected a beat
            this.lastBeatTime = currentTime;
            this.beatHistory.push(currentTime);
            
            // Keep only recent beats (last 4 seconds for faster adaptation)
            const fourSecondsAgo = currentTime - 4000;
            this.beatHistory = this.beatHistory.filter(time => time > fourSecondsAgo);
            
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
        if (currentTime - this.lastBeatTime > 2000 && this.beatHistory.length > 0) { // Shorter timeout
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
        
        // Use the improved chord detector if available
        if (this.improvedDetector) {
            console.log("Using improved chord detector...");
            const result = this.improvedDetector.detectChord(audioData, frequencyData);
            console.log("Improved detector result:", result);
            return result;
        }
        
        console.log("Improved detector not available, using fallback");
        // Fallback to original detection if improved detector is not available
        const hasOnset = this.detectOnset(frequencyData);
        const currentTime = performance.now();
        const shouldAnalyze = hasOnset || this.shouldSample(currentTime);
        
        if (!shouldAnalyze) {
            return null;
        }
        
        const fundamentals = this.findFundamentalFrequencies(frequencyData);
        const notesWithOctaves = fundamentals.map(freq => this.frequencyToNoteWithOctave(freq));
        return this.identifyChordWithTemporalAnalysis(notesWithOctaves, fundamentals);
    }

    findFundamentalFrequencies(frequencyData) {
        const peaks = [];
        const sampleRate = this.audioContext.sampleRate;
        const bufferLength = frequencyData.length;
        
        // Fixed high sensitivity threshold for studio audio (much lower)
        const amplitudeThreshold = 16; // Very low threshold for maximum sensitivity
        
        // Find all local maxima with improved peak detection
        for (let i = 2; i < bufferLength - 2; i++) {
            const current = frequencyData[i];
            const prev1 = frequencyData[i - 1];
            const prev2 = frequencyData[i - 2];
            const next1 = frequencyData[i + 1];
            const next2 = frequencyData[i + 2];
            
            // Relaxed peak detection for more sensitivity
            if (current > prev1 && current > next1 &&
                current > prev2 && current > next2 &&
                current > amplitudeThreshold) {
                
                const frequency = i * sampleRate / (bufferLength * 2);
                
                // Extended frequency range for better detection
                if (frequency > 50 && frequency < 1500) { // Wider range
                    // Calculate peak prominence
                    const leftMin = Math.min(prev1, prev2);
                    const rightMin = Math.min(next1, next2);
                    const prominence = current - Math.max(leftMin, rightMin);
                    
                    // Include even weak peaks for studio audio
                    if (prominence > 8) { // Lower prominence threshold
                        peaks.push({
                            frequency: frequency,
                            amplitude: current,
                            bin: i,
                            prominence: prominence
                        });
                    }
                }
            }
        }
        
        // Sort by amplitude for studio audio (more reliable than prominence)
        peaks.sort((a, b) => b.amplitude - a.amplitude);
        const fundamentals = [];
        
        // More permissive harmonic filtering for studio audio
        for (let i = 0; i < peaks.length && fundamentals.length < 8; i++) { // More peaks allowed
            const peak = peaks[i];
            let isHarmonic = false;
            
            // Check if this peak is a harmonic of an existing fundamental
            for (let j = 0; j < fundamentals.length; j++) {
                const fundamental = fundamentals[j];
                const ratio = peak.frequency / fundamental.frequency;
                
                // More permissive harmonic detection for studio audio
                if (Math.abs(ratio - Math.round(ratio)) < 0.1) { // More tolerance
                    isHarmonic = true;
                    break;
                }
                
                // Also check if this could be the fundamental of existing harmonics
                const inverseRatio = fundamental.frequency / peak.frequency;
                if (Math.abs(inverseRatio - Math.round(inverseRatio)) < 0.1) {
                    // Replace the harmonic with this fundamental
                    fundamentals[j] = peak;
                    isHarmonic = true;
                    break;
                }
            }
            
            if (!isHarmonic) {
                fundamentals.push(peak);
            }
        }
        
        // Sort by frequency for consistent ordering
        fundamentals.sort((a, b) => a.frequency - b.frequency);
        
        return fundamentals.map(peak => peak.frequency);
    }

    detectOnset(frequencyData) {
        if (!this.previousSpectrum) {
            this.previousSpectrum = new Array(frequencyData.length).fill(0);
            return false;
        }
        
        // Calculate spectral flux (difference between current and previous spectrum)
        let spectralFlux = 0;
        for (let i = 0; i < frequencyData.length; i++) {
            const diff = frequencyData[i] - this.previousSpectrum[i];
            if (diff > 0) spectralFlux += diff;
        }
        
        // Normalize spectral flux
        spectralFlux = spectralFlux / frequencyData.length;
        
        // Update spectral flux history
        this.spectralFluxHistory.push(spectralFlux);
        if (this.spectralFluxHistory.length > 10) {
            this.spectralFluxHistory.shift();
        }
        
        // Fixed low threshold for studio audio - much more sensitive
        const onsetThreshold = 0.5; // Very low threshold for maximum sensitivity
        
        const currentTime = performance.now();
        const onsetDetected = spectralFlux > onsetThreshold &&
                             currentTime - this.lastOnsetTime > 50; // Shorter cooldown
        
        // Update previous spectrum
        this.previousSpectrum = [...frequencyData];
        
        if (onsetDetected) {
            this.lastOnsetTime = currentTime;
            console.log(`Onset detected: flux=${spectralFlux.toFixed(4)}`);
        }
        
        return onsetDetected;
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

    identifyChordWithTemporalAnalysis(notesWithOctaves, frequencies) {
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
            
            // Set output device using setSinkId
            try {
                await this.audioContext.setSinkId(outputDeviceId);
                console.log('enableAudioOutput: Output device set to:', outputDeviceId);
            } catch (error) {
                console.warn('enableAudioOutput: setSinkId not supported, using default device:', error);
            }
            
            // Create delay node for audio output with 1 second delay
            this.delayNode = this.audioContext.createDelay();
            this.delayNode.delayTime.setValueAtTime(this.delayTime, this.audioContext.currentTime);
            
            // Create gain node for delayed audio
            this.delayGain = this.audioContext.createGain();
            this.delayGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
            
            // Connect source -> delay -> gain -> destination
            this.source.connect(this.delayNode);
            this.delayNode.connect(this.delayGain);
            this.delayGain.connect(this.audioContext.destination);
            
            console.log('enableAudioOutput: Audio delay chain created with 1 second delay');
            
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
                this.announcementGain.connect(this.audioContext.destination);
                
                // Start oscillator (it will be silent until we adjust gain)
                this.announcementOscillator.start();
                console.log('enableAudioOutput: Oscillator started');
            } else {
                console.log('enableAudioOutput: Using existing oscillator');
            }
            
            this.audioOutputEnabled = true;
            
            // Hide manual buttons since it's now automatic
            this.enableAudioOutputBtn.classList.add('hidden');
            this.disableAudioOutputBtn.classList.add('hidden');
            
            console.log('enableAudioOutput: Successfully enabled');
            this.status.textContent = 'Audio con retraso de 2 segundos activado. Los acordes se muestran antes de reproducirse.';
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
            this.status.textContent = 'Error al activar audio con retraso: ' + error.message;
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
            
            // Disconnect delay chain
            if (this.delayNode) {
                this.delayNode.disconnect();
                this.delayNode = null;
            }
            if (this.delayGain) {
                this.delayGain.disconnect();
                this.delayGain = null;
            }
            
            // Reconnect source directly to analyser (no delay)
            if (this.source && this.analyser) {
                this.source.disconnect();
                this.source.connect(this.analyser);
            }
            
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
            
            this.status.textContent = 'Audio con retraso desactivado';
            this.status.className = 'status';
        }
    }

    addChordToBuffer(chord, detectionTime) {
        // Add chord to buffer with timestamp
        this.chordBuffer.push({
            chord: chord,
            detectionTime: detectionTime,
            playTime: detectionTime + 2000 // 2-second delay
        });
        
        // Limit buffer size
        if (this.chordBuffer.length > this.maxBufferSize) {
            this.chordBuffer.shift();
        }
        
        console.log(`Chord buffer: added ${chord.name} at ${detectionTime}, will play at ${detectionTime + 2000}`);
    }

    updateDisplayWithDelayedChord(currentTime) {
        // Find the chord that should be playing now (after 2-second delay)
        const currentPlayTime = currentTime;
        let chordToDisplay = null;
        
        // Look for chords that should be playing now
        for (let i = this.chordBuffer.length - 1; i >= 0; i--) {
            const chordData = this.chordBuffer[i];
            
            // If this chord's play time is in the past or very close to current time
            if (chordData.playTime <= currentPlayTime + 100) { // 100ms tolerance
                chordToDisplay = chordData.chord;
                break;
            }
        }
        
        // Update display if we found a chord to show
        if (chordToDisplay) {
            this.currentChord.textContent = chordToDisplay.name;
            this.confidence.textContent = `Confianza: ${Math.round(chordToDisplay.confidence * 100)}%`;
            
            // Update detected notes display
            if (chordToDisplay.notes && chordToDisplay.notes.length > 0) {
                this.detectedNotes.textContent = `Notas: ${chordToDisplay.notes.join(', ')}`;
            } else {
                this.detectedNotes.textContent = 'Notas: --';
            }
            
            this.currentDisplayedChord = chordToDisplay;
        } else if (this.currentDisplayedChord) {
            // Keep displaying the current chord if no new chord found
            this.currentChord.textContent = this.currentDisplayedChord.name;
            this.confidence.textContent = `Confianza: ${Math.round(this.currentDisplayedChord.confidence * 100)}%`;
            
            if (this.currentDisplayedChord.notes && this.currentDisplayedChord.notes.length > 0) {
                this.detectedNotes.textContent = `Notas: ${this.currentDisplayedChord.notes.join(', ')}`;
            } else {
                this.detectedNotes.textContent = 'Notas: --';
            }
        } else {
            // No chord to display
            this.currentChord.textContent = '--';
            this.detectedNotes.textContent = 'Notas: --';
            this.confidence.textContent = 'Confianza: 0%';
        }
    }

    playChordAnnouncement(chordName, detectionTime) {
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

        // Calculate remaining delay time (1 second minus time already passed since detection)
        const currentTime = performance.now();
        const timeSinceDetection = currentTime - detectionTime;
        const remainingDelay = Math.max(0, 2000 - timeSinceDetection); // Ensure at least 0ms delay
        
        console.log(`playChordAnnouncement: Chord ${chordName}, scheduling announcement in ${remainingDelay}ms`);

        // Schedule the announcement using setTimeout for precise timing
        setTimeout(() => {
            if (!this.audioOutputEnabled || !this.announcementOscillator || !this.announcementGain) {
                return;
            }

            // Mark chord as playing for red highlight
            this.playingChords.set(chordName, Date.now());
            
            // Auto-remove playing status after 0.5 seconds
            setTimeout(() => {
                this.playingChords.delete(chordName);
                this.updateTicker(); // Update ticker to remove red highlight
            }, 500);

            // Map chord to frequency for announcement tone - use root note frequency
            const noteFrequencies = {
                // Major chords - root note frequencies
                'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
                'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
                'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88,
                
                // Minor chords - same root note frequencies as major
                'Cm': 261.63, 'C#m': 277.18, 'Dm': 293.66, 'D#m': 311.13,
                'Em': 329.63, 'Fm': 349.23, 'F#m': 369.99, 'Gm': 392.00,
                'G#m': 415.30, 'Am': 440.00, 'A#m': 466.16, 'Bm': 493.88,
                
                // Extended chords - use root note frequencies
                'C7': 261.63, 'C#7': 277.18, 'D7': 293.66, 'D#7': 311.13,
                'E7': 329.63, 'F7': 349.23, 'F#7': 369.99, 'G7': 392.00,
                'G#7': 415.30, 'A7': 440.00, 'A#7': 466.16, 'B7': 493.88,
                'Cm7': 261.63, 'C#m7': 277.18, 'Dm7': 293.66, 'D#m7': 311.13,
                'Em7': 329.63, 'Fm7': 349.23, 'F#m7': 369.99, 'Gm7': 392.00,
                'G#m7': 415.30, 'Am7': 440.00, 'A#m7': 466.16, 'Bm7': 493.88,
                'Cmaj7': 261.63, 'C#maj7': 277.18, 'Dmaj7': 293.66, 'D#maj7': 311.13,
                'Emaj7': 329.63, 'Fmaj7': 349.23, 'F#maj7': 369.99, 'Gmaj7': 392.00,
                'G#maj7': 415.30, 'Amaj7': 440.00, 'A#maj7': 466.16, 'Bmaj7': 493.88
            };

            const frequency = noteFrequencies[chordName] || 440;
            
            // Set oscillator type and frequency
            this.announcementOscillator.type = 'sine';
            this.announcementOscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            
            // Create a short beep sound (0.3 seconds) with clean fade-out
            const now = this.audioContext.currentTime;
            this.announcementGain.gain.cancelScheduledValues(now); // Cancel any previous schedules
            this.announcementGain.gain.setValueAtTime(0.5, now); // Start at 50% volume
            this.announcementGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25); // Fade out over 0.25 seconds
            this.announcementGain.gain.linearRampToValueAtTime(0, now + 0.3); // Ensure complete silence at 0.3 seconds
            
            console.log(`playChordAnnouncement: Playing chord ${chordName} at frequency ${frequency}Hz`);
        }, remainingDelay);
    }
}

// Initialize the chord detector when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChordDetector();
});
