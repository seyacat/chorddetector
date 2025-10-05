class ChordDetector {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.stream = null;
        this.isRunning = false;
        this.animationId = null;
        
        // Chord stabilization variables
        this.lastChordDetectionTime = 0;
        this.minDetectionInterval = 100; // Minimum time between detections (ms)
        this.chordVotes = new Map(); // Track chord votes over time
        this.multiChordVotes = new Map(); // Track multiple chords by frequency range
        this.votingWindow = 500; // 500ms voting window
        this.stableChordThreshold = 0.6; // 60% of votes needed to confirm chord
        this.currentStableChord = null;
        this.currentMultiChords = []; // Array for multiple chords
        this.lastStableChordTime = 0;
        this.multiChordMode = true; // Always enabled for multi-chord detection
        
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
        
        // Browser chord detector (compatible with Electron)
        this.browserDetector = null;
        
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
        this.vstPlugin = document.getElementById('vstPlugin');
        this.scanVSTBtn = document.getElementById('scanVSTBtn');
        this.showVSTGUIBtn = document.getElementById('showVSTGUIBtn');
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
        this.multiChordBtn = document.getElementById('multiChordBtn');
        this.announcementBtn = document.getElementById('announcementBtn');
        
        // Set canvas dimensions
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
        
        // Initialize multi-chord button state
        this.updateMultiChordButton();
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
        this.startBtn.addEventListener('click', () => this.startDetection());
        this.stopBtn.addEventListener('click', () => this.stopDetection());
        this.audioInput.addEventListener('change', () => this.onDeviceChange());
        this.audioOutput.addEventListener('change', () => this.onDeviceChange());
        this.vstPlugin.addEventListener('change', () => this.onVSTPluginChange());
        this.scanVSTBtn.addEventListener('click', () => this.scanVSTPlugins());
        this.showVSTGUIBtn.addEventListener('click', () => this.showVSTPluginGUI());
        this.enableAudioOutputBtn.addEventListener('click', () => this.enableAudioOutput());
        this.disableAudioOutputBtn.addEventListener('click', () => this.disableAudioOutput());
        this.multiChordBtn.addEventListener('click', () => this.toggleMultiChordMode());
        this.announcementBtn.addEventListener('click', () => this.toggleAnnouncements());

        // Setup VST event listeners
        this.setupVSTEventListeners();
    }

    setupVisibilityHandlers() {
        // Handle page visibility changes to prevent AudioContext suspension
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.handlePageHidden();
            } else {
                this.handlePageVisible();
            }
        });

        // Handle window focus/blur events
        window.addEventListener('blur', () => {
            this.handlePageHidden();
        });

        window.addEventListener('focus', () => {
            this.handlePageVisible();
        });
    }

    async handlePageHidden() {
        // When page loses focus, we don't need to do anything special
        // The AudioContext will automatically suspend, but we'll resume it when needed
    }

    async handlePageVisible() {
        // When page becomes visible again, resume AudioContext if it was suspended
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                
                // If audio output was enabled, restart it
                if (this.audioOutputEnabled) {
                    setTimeout(() => {
                        this.enableAudioOutput();
                    }, 100);
                }
            } catch (error) {
                // Silently handle error
            }
        }
    }

    onDeviceChange() {
        const inputDeviceId = this.audioInput.value;
        const outputDeviceId = this.audioOutput.value;
        
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
            this.stopDetection();
            setTimeout(() => this.startDetection(), 100);
        } else if (!isOutputChange && inputDeviceId && !this.isRunning) {
            // If not running and input device selected, start automatically
            this.startDetection();
        }
        
        // Handle output device change - SIMPLIFIED LOGIC
        if (outputDeviceId && this.isRunning) {
            // If running and output device selected, enable/restart output
            if (this.audioOutputEnabled) {
                // If already enabled, update output device
                this.updateOutputDevice();
            } else {
                // If not enabled, enable it
                this.enableAudioOutput();
            }
        } else if (!outputDeviceId && this.audioOutputEnabled) {
            // If output device deselected while enabled, disable
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

    toggleMultiChordMode() {
        this.multiChordMode = !this.multiChordMode;
        this.updateMultiChordButton();
        
        if (this.multiChordMode) {
            this.status.textContent = 'Modo multi-acorde activado. Analizando graves, medios y agudos por separado.';
            this.status.className = 'status info';
        } else {
            this.status.textContent = 'Modo multi-acorde desactivado. Usando detección estándar.';
            this.status.className = 'status';
        }
        
        // Clear chord buffers when switching modes
        this.chordVotes.clear();
        this.multiChordVotes.clear();
        this.currentStableChord = null;
        this.currentMultiChords = [];
        this.chordBuffer = [];
    }

    updateMultiChordButton() {
        if (this.multiChordMode) {
            this.multiChordBtn.textContent = 'Desactivar Multi-Acorde';
            this.multiChordBtn.classList.add('active');
        } else {
            this.multiChordBtn.textContent = 'Activar Multi-Acorde';
            this.multiChordBtn.classList.remove('active');
        }
    }

    updateDisplayWithMultiChords(multiChord) {
        if (!multiChord || !multiChord.isMultiChord) {
            this.updateDisplayWithDelayedChord(performance.now());
            return;
        }

        // Display multiple chords with their ranges and colors
        const chordDisplay = multiChord.chords.map((chord, index) => {
            const color = chord.color || '#4ecdc4';
            const rangeName = this.getRangeDisplayName(chord.range);
            return `<span style="color: ${color}">${chord.name} (${rangeName})</span>`;
        }).join(' / ');

        this.currentChord.innerHTML = chordDisplay;
        this.confidence.textContent = `Confianza: ${Math.round(multiChord.confidence * 100)}%`;
        
        // Show all detected notes from all chords
        if (multiChord.notes && multiChord.notes.length > 0) {
            this.detectedNotes.textContent = `Notas: ${multiChord.notes.join(', ')}`;
        } else {
            this.detectedNotes.textContent = 'Notas: --';
        }
    }

    getRangeDisplayName(range) {
        const rangeNames = {
            'bass': 'Graves',
            'mid': 'Medios',
            'treble': 'Agudos'
        };
        return rangeNames[range] || range;
    }

    toggleAnnouncements() {
        if (this.audioOutputEnabled) {
            console.log('toggleAnnouncements: Disabling audio output');
            this.disableAudioOutput();
            this.announcementBtn.textContent = 'Activar Anuncios de Audio';
            this.announcementBtn.classList.remove('active');
            this.status.textContent = 'Anuncios de audio desactivados';
            this.status.className = 'status';
        } else {
            console.log('toggleAnnouncements: Enabling audio output');
            this.enableAudioOutput();
            this.announcementBtn.textContent = 'Desactivar Anuncios de Audio';
            this.announcementBtn.classList.add('active');
            this.status.textContent = 'Anuncios de audio activados con 2 segundos de retraso';
            this.status.className = 'status info';
        }
    }

    processAudio() {
        if (!this.isRunning) return;

        // In VST mode, we don't have audioContext/analyser
        if (this.audioContext && this.analyser) {
            // Regular audio device mode
            // Check if AudioContext is suspended and try to resume it
            if (this.audioContext.state === 'suspended') {
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

            // Improved chord detection with stabilization
            const currentTime = performance.now();
            
            // Detect chord with minimum interval to avoid over-processing
            if (currentTime - this.lastChordDetectionTime > this.minDetectionInterval) {
                const chord = this.detectChord(dataArray);
                
                if (chord && chord.confidence > 0.5) { // Lower confidence threshold for better detection
                    // Add vote for this chord
                    this.addChordVote(chord.name, currentTime);
                    
                    // Check if we have a stable chord
                    const stableChord = this.getStableChord(currentTime);
                    
                    if (stableChord && stableChord !== this.currentStableChord) {
                        // New stable chord detected
                        this.currentStableChord = stableChord;
                        this.lastStableChordTime = currentTime;
                        
                        // Store chord in buffer with timestamp for 2-second delay synchronization
                        this.addChordToBuffer(chord, currentTime);
                        
                        // Add to ticker only if chord changed
                        if (this.lastChord !== stableChord) {
                            this.addToTicker(stableChord);
                            this.lastChord = stableChord;
                            this.lastDetectionTime = currentTime;
                            
                        // Play chord announcement if audio output is enabled
                        if (this.audioOutputEnabled) {
                            this.playNotesAnnouncement(chord, currentTime);
                        }
                        } else {
                            // Add empty space when chord doesn't change
                            this.addToTicker(null);
                        }
                    } else if (stableChord) {
                        // Same stable chord - add empty space
                        this.addToTicker(null);
                    } else {
                        // No stable chord - add empty space
                        this.addToTicker(null);
                    }
                    
                    this.lastChordDetectionTime = currentTime;
                } else {
                    // No chord detected - add empty space to ticker
                    this.addToTicker(null);
                    this.lastChordDetectionTime = currentTime;
                }
            }
            
            // Always update display with delayed chord (continuous display update)
            this.updateDisplayWithDelayedChord(currentTime);

            // Update ticker colors based on timing
            this.updateTicker();
        } else {
            // VST mode - simulate processing without audio data
            const currentTime = performance.now();
            
            // In VST mode, we need to get audio data from the VST bridge
            // For now, we'll just update the display and ticker
            this.updateDisplayWithDelayedChord(currentTime);
            this.updateTicker();
            
            // Add empty space to ticker to keep it moving
            this.addToTicker(null);
        }
        
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

    // BPM display is now static since we use continuous detection
    // This method is kept for display purposes only
    updateBPMDisplay() {
        this.bpmDisplay.textContent = 'BPM: --';
    }

    drawWaveform(dataArray) {
        const canvas = this.canvas;
        const ctx = this.canvasContext;
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);

        // In VST mode, we don't have audio data, so draw a placeholder
        if (!dataArray || dataArray.length === 0) {
            // Draw VST mode indicator
            ctx.fillStyle = 'rgba(78, 205, 196, 0.5)';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('VST Mode - Audio from Plugin', width / 2, height / 2);
            return;
        }

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
        // Check if we have an analyser (not available in VST mode)
        if (!this.analyser) {
            // In VST mode, we need to handle audio differently
            // For now, return null since we don't have frequency data
            return null;
        }
        
        // Use both time domain and frequency domain analysis
        const bufferLength = this.analyser.frequencyBinCount;
        const frequencyData = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(frequencyData);
        
        // Use multi-chord detection by frequency ranges
        if (this.multiChordMode) {
            return this.detectChordsByFrequencyRanges(frequencyData);
        } else {
            // Always use the browser-based detection method
            return this.fallbackChordDetection(audioData, frequencyData);
        }
    }

    detectChordsByFrequencyRanges(frequencyData) {
        // Check if we have audio context (not available in VST mode)
        if (!this.audioContext) {
            return null;
        }
        
        const sampleRate = this.audioContext.sampleRate;
        const bufferLength = frequencyData.length;
        
        // Define frequency ranges for analysis
        const frequencyRanges = [
            { name: 'bass', minFreq: 50, maxFreq: 250, color: '#ff6b6b' },      // Graves (acordes de bajo)
            { name: 'mid', minFreq: 250, maxFreq: 1000, color: '#4ecdc4' },    // Medios (acordes principales)
            { name: 'treble', minFreq: 1000, maxFreq: 5000, color: '#45b7d1' } // Agudos (melodía/armonías)
        ];
        
        const detectedChords = [];
        
        // Analyze each frequency range separately
        frequencyRanges.forEach(range => {
            // Extract frequency data for this range
            const rangeData = this.extractFrequencyRange(frequencyData, sampleRate, bufferLength, range.minFreq, range.maxFreq);
            
            if (rangeData.length > 0) {
                // Find fundamental frequencies in this range
                const fundamentals = this.findFundamentalFrequenciesInRange(rangeData, sampleRate, bufferLength, range.minFreq, range.maxFreq);
                
                if (fundamentals.length >= 2) {
                    // Convert frequencies to notes
                    const notesWithOctaves = fundamentals.map(freq => this.frequencyToNoteWithOctave(freq));
                    
                    // Identify chord for this range
                    const chord = this.identifyChordWithTemporalAnalysis(notesWithOctaves, fundamentals);
                    
                    if (chord && chord.confidence > 0.4) { // Lower threshold for multi-chord detection
                        chord.range = range.name;
                        chord.color = range.color;
                        detectedChords.push(chord);
                    }
                }
            }
        });
        
        // Return the best chord if only one detected, or multiple if available
        if (detectedChords.length === 0) {
            return null;
        } else if (detectedChords.length === 1) {
            return detectedChords[0];
        } else {
            // Return multiple chords sorted by confidence
            detectedChords.sort((a, b) => b.confidence - a.confidence);
            return {
                name: detectedChords.map(c => c.name).join(' / '),
                confidence: Math.max(...detectedChords.map(c => c.confidence)),
                notes: detectedChords.flatMap(c => c.notes || []),
                ranges: detectedChords.map(c => c.range),
                colors: detectedChords.map(c => c.color),
                isMultiChord: true,
                chords: detectedChords
            };
        }
    }

    extractFrequencyRange(frequencyData, sampleRate, bufferLength, minFreq, maxFreq) {
        const rangeData = new Uint8Array(bufferLength);
        const minBin = Math.floor(minFreq * bufferLength * 2 / sampleRate);
        const maxBin = Math.floor(maxFreq * bufferLength * 2 / sampleRate);
        
        // Copy only the frequency bins within the specified range
        for (let i = 0; i < bufferLength; i++) {
            if (i >= minBin && i <= maxBin) {
                rangeData[i] = frequencyData[i];
            } else {
                rangeData[i] = 0;
            }
        }
        
        return rangeData;
    }

    findFundamentalFrequenciesInRange(frequencyData, sampleRate, bufferLength, minFreq, maxFreq) {
        const peaks = [];
        const amplitudeThreshold = 12; // Lower threshold for range-specific detection
        
        // Find peaks only within the specified frequency range
        const minBin = Math.floor(minFreq * bufferLength * 2 / sampleRate);
        const maxBin = Math.floor(maxFreq * bufferLength * 2 / sampleRate);
        
        for (let i = Math.max(2, minBin); i < Math.min(bufferLength - 2, maxBin); i++) {
            const current = frequencyData[i];
            const prev1 = frequencyData[i - 1];
            const prev2 = frequencyData[i - 2];
            const next1 = frequencyData[i + 1];
            const next2 = frequencyData[i + 2];
            
            if (current > prev1 && current > next1 &&
                current > prev2 && current > next2 &&
                current > amplitudeThreshold) {
                
                const frequency = i * sampleRate / (bufferLength * 2);
                
                // Calculate peak prominence
                const leftMin = Math.min(prev1, prev2);
                const rightMin = Math.min(next1, next2);
                const prominence = current - Math.max(leftMin, rightMin);
                
                if (prominence > 6) { // Lower prominence threshold for range detection
                    peaks.push({
                        frequency: frequency,
                        amplitude: current,
                        bin: i,
                        prominence: prominence
                    });
                }
            }
        }
        
        // Sort by amplitude and take top peaks
        peaks.sort((a, b) => b.amplitude - a.amplitude);
        const fundamentals = [];
        
        // More permissive harmonic filtering for range-specific detection
        for (let i = 0; i < peaks.length && fundamentals.length < 6; i++) {
            const peak = peaks[i];
            let isHarmonic = false;
            
            for (let j = 0; j < fundamentals.length; j++) {
                const fundamental = fundamentals[j];
                const ratio = peak.frequency / fundamental.frequency;
                
                if (Math.abs(ratio - Math.round(ratio)) < 0.15) { // More tolerance for range detection
                    isHarmonic = true;
                    break;
                }
                
                const inverseRatio = fundamental.frequency / peak.frequency;
                if (Math.abs(inverseRatio - Math.round(inverseRatio)) < 0.15) {
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

    fallbackChordDetection(audioData, frequencyData) {
        // Check if we have audio context (not available in VST mode)
        if (!this.audioContext) {
            return null;
        }
        
        // Original chord detection method that worked before
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

    shouldSample(currentTime) {
        // Sample every 500ms if no onset detected
        return currentTime - this.lastChordDetectionTime > 500;
    }

    findFundamentalFrequencies(frequencyData) {
        // Check if we have audio context (not available in VST mode)
        if (!this.audioContext) {
            return [];
        }
        
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
            console.log('disableAudioOutput: Disabling chord announcements only');
            
            // Solo silencia el oscilador de acordes, mantiene el audio original
            if (this.announcementGain) {
                this.announcementGain.gain.cancelScheduledValues(this.audioContext.currentTime);
                this.announcementGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            }
            
            // NO desconectamos el delay chain para mantener el audio original
            // El audio de entrada sigue reproduciéndose normalmente
            
            this.audioOutputEnabled = false;
            this.lastAnnouncedChord = null;
            
            // Hide manual buttons since it's now automatic
            this.enableAudioOutputBtn.classList.add('hidden');
            this.disableAudioOutputBtn.classList.add('hidden');
            
            this.status.textContent = 'Anuncios de acordes desactivados - Audio original sigue reproduciéndose';
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
            
                // Update detected notes display with octaves
                if (chordToDisplay.notes && chordToDisplay.notes.length > 0) {
                    // Get the full notes array with octaves from the chord buffer
                    const chordData = this.chordBuffer.find(data => data.chord === chordToDisplay);
                    if (chordData && chordData.chord.fullNotes) {
                        const notesWithOctaves = chordData.chord.fullNotes.map(n => `${n.note}${n.octave}`);
                        this.detectedNotes.textContent = `Notas: ${notesWithOctaves.join(', ')}`;
                    } else {
                        this.detectedNotes.textContent = `Notas: ${chordToDisplay.notes.join(', ')}`;
                    }
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

    addChordVote(chordName, currentTime) {
        // Add vote for this chord
        if (!this.chordVotes.has(chordName)) {
            this.chordVotes.set(chordName, []);
        }
        
        const votes = this.chordVotes.get(chordName);
        votes.push(currentTime);
        
        // Clean old votes (keep only votes from the voting window)
        const cutoffTime = currentTime - this.votingWindow;
        const recentVotes = votes.filter(time => time > cutoffTime);
        this.chordVotes.set(chordName, recentVotes);
    }

    getStableChord(currentTime) {
        let bestChord = null;
        let bestVoteCount = 0;
        let totalVotes = 0;
        
        // Count total votes in the voting window
        for (const [chordName, votes] of this.chordVotes) {
            const recentVotes = votes.filter(time => time > currentTime - this.votingWindow);
            totalVotes += recentVotes.length;
            
            if (recentVotes.length > bestVoteCount) {
                bestVoteCount = recentVotes.length;
                bestChord = chordName;
            }
        }
        
        // Check if the best chord meets the threshold
        if (bestChord && totalVotes > 0) {
            const voteRatio = bestVoteCount / totalVotes;
            if (voteRatio >= this.stableChordThreshold) {
                return bestChord;
            }
        }
        
        return null;
    }

    playNotesAnnouncement(chord, detectionTime) {
        if (!this.audioOutputEnabled) {
            console.log(`playNotesAnnouncement: Audio output not enabled`);
            return;
        }

        // Only announce if chord changed
        if (this.lastAnnouncedChord === chord.name) {
            console.log(`playNotesAnnouncement: Chord ${chord.name} same as last, skipping`);
            return;
        }

        this.lastAnnouncedChord = chord.name;

        // Calculate remaining delay time (2 seconds minus time already passed since detection)
        const currentTime = performance.now();
        const timeSinceDetection = currentTime - detectionTime;
        const remainingDelay = Math.max(0, 2000 - timeSinceDetection); // Ensure at least 0ms delay
        
        console.log(`playNotesAnnouncement: Chord ${chord.name} detected at ${detectionTime}, current time ${currentTime}, time since detection ${timeSinceDetection}ms, scheduling in ${remainingDelay}ms`);

        // Schedule the announcement using setTimeout for precise timing
        setTimeout(() => {
            if (!this.audioOutputEnabled) {
                return;
            }

            // Mark chord as playing for red highlight
            this.playingChords.set(chord.name, Date.now());
            
            // Auto-remove playing status after 0.5 seconds
            setTimeout(() => {
                this.playingChords.delete(chord.name);
                this.updateTicker(); // Update ticker to remove red highlight
            }, 500);

            // Play the chord immediately (no additional delay)
            console.log(`playNotesAnnouncement: Playing chord ${chord.name} NOW`);
            
            // Generate generic notes for the chord if they don't exist
            const notesToPlay = chord.fullNotes || this.generateGenericChordNotes(chord.name);
            this.playNotesSequentially(notesToPlay);
            
        }, remainingDelay);
    }

    playNotesSequentially(notes) {
        if (!notes || notes.length === 0) {
            console.log('playNotesSequentially: No notes to play');
            return;
        }

        console.log(`playNotesSequentially: Playing chord with ${notes.length} notes:`, notes.map(n => `${n.note}${n.octave}`));

        // Play the chord as a harmonious chord (all notes together)
        const chordStartTime = this.audioContext.currentTime;
        
        // Play all notes simultaneously to create a rich chord sound
        notes.forEach((note, index) => {
            // Very slight delay for each note to create a richer sound (2-10ms spread)
            const noteDelay = index * 0.002; // 2ms between note starts
            const noteStartTime = chordStartTime + noteDelay;
            
            // Schedule the note with musical characteristics
            this.scheduleSimpleChordNote(note.frequency, noteStartTime, 1.0); // 1 second duration for chord
        });
    }

    scheduleMusicalChordNote(frequency, startTime, duration) {
        // Create a new oscillator for each note with richer, more musical sound
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        // Use sawtooth wave for richer harmonic content (sounds more like real instruments)
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(frequency, startTime);
        
        // Add slight detuning for richer sound (3-5 cents) - more realistic
        const detune = (Math.random() - 0.5) * 5; // ±2.5 cents
        oscillator.detune.setValueAtTime(detune, startTime);
        
        // Create a more musical envelope with gentle attack and release
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.05); // Quick attack
        gainNode.gain.exponentialRampToValueAtTime(0.15, startTime + 0.2); // Slight decay
        gainNode.gain.setValueAtTime(0.15, startTime + duration - 0.3); // Sustain
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration - 0.1); // Gentle fade out
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration); // Complete silence
        
        // Connect nodes
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        // Start and stop the oscillator
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
        
        console.log(`Scheduled musical chord note: ${frequency.toFixed(1)}Hz at ${startTime.toFixed(2)}s`);
    }

    scheduleSimpleChordNote(frequency, startTime, duration) {
        // Create a simple oscillator for each note
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        // Use sine wave for clean sound
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startTime);
        
        // Simple gain envelope
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05); // Quick attack
        gainNode.gain.setValueAtTime(0.3, startTime + duration - 0.1); // Sustain
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration - 0.05); // Fade out
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration); // Complete silence
        
        // Connect nodes
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        // Start and stop the oscillator
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
        
        console.log(`Scheduled simple chord note: ${frequency.toFixed(1)}Hz at ${startTime.toFixed(2)}s`);
    }

    scheduleChordNote(frequency, startTime, duration) {
        // Create a new oscillator for each note with richer sound
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        // Use triangle wave for softer, more musical sound
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, startTime);
        
        // Add slight detuning for richer sound (1-2 cents)
        const detune = (Math.random() - 0.5) * 2; // ±1 cent
        oscillator.detune.setValueAtTime(detune, startTime);
        
        // Configure gain envelope for musical chord sound
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.1); // Gentle attack
        gainNode.gain.setValueAtTime(0.15, startTime + duration - 0.2); // Sustain
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration - 0.05); // Gentle fade out
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration); // Complete silence
        
        // Connect nodes
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        // Start and stop the oscillator
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
        
        console.log(`Scheduled chord note: ${frequency.toFixed(1)}Hz at ${startTime.toFixed(2)}s`);
    }

    generateGenericChordNotes(chordName) {
        // Generate generic notes for common chords (root, third, fifth)
        const chordNotes = {
            // Major chords
            'C': ['C4', 'E4', 'G4'],
            'C#': ['C#4', 'F4', 'G#4'],
            'D': ['D4', 'F#4', 'A4'],
            'D#': ['D#4', 'G4', 'A#4'],
            'E': ['E4', 'G#4', 'B4'],
            'F': ['F4', 'A4', 'C5'],
            'F#': ['F#4', 'A#4', 'C#5'],
            'G': ['G4', 'B4', 'D5'],
            'G#': ['G#4', 'C5', 'D#5'],
            'A': ['A4', 'C#5', 'E5'],
            'A#': ['A#4', 'D5', 'F5'],
            'B': ['B4', 'D#5', 'F#5'],
            
            // Minor chords
            'Cm': ['C4', 'Eb4', 'G4'],
            'C#m': ['C#4', 'E4', 'G#4'],
            'Dm': ['D4', 'F4', 'A4'],
            'D#m': ['D#4', 'F#4', 'A#4'],
            'Em': ['E4', 'G4', 'B4'],
            'Fm': ['F4', 'Ab4', 'C5'],
            'F#m': ['F#4', 'A4', 'C#5'],
            'Gm': ['G4', 'Bb4', 'D5'],
            'G#m': ['G#4', 'B4', 'D#5'],
            'Am': ['A4', 'C5', 'E5'],
            'A#m': ['A#4', 'C#5', 'F5'],
            'Bm': ['B4', 'D5', 'F#5']
        };

        const notes = chordNotes[chordName] || ['C4', 'E4', 'G4']; // Default to C major
        
        // Convert note strings to frequency objects
        return notes.map(noteString => {
            const note = noteString.slice(0, -1); // Remove octave
            const octave = parseInt(noteString.slice(-1));
            const frequency = this.noteToFrequency(note, octave);
            
            return {
                note: note,
                octave: octave,
                frequency: frequency
            };
        });
    }

    noteToFrequency(note, octave) {
        // Standard note frequencies (A4 = 440Hz)
        const noteFrequencies = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
            'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
        };
        
        const baseFrequency = noteFrequencies[note] || 440;
        const octaveDifference = octave - 4;
        return baseFrequency * Math.pow(2, octaveDifference);
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


// VST Plugin Management Methods
ChordDetector.prototype.setupVSTEventListeners = function() {
    if (window.electronAPI) {
        window.electronAPI.onVSTStatus((message) => {
            console.log('VST Status:', message);
            this.status.textContent = `VST: ${message}`;
            this.status.className = 'status info';
        });

        window.electronAPI.onVSTError((message) => {
            console.error('VST Error:', message);
            this.status.textContent = `VST Error: ${message}`;
            this.status.className = 'status error';
        });

        window.electronAPI.onVSTPluginsScanned((plugins) => {
            this.populateVSTPluginList(plugins);
        });
    }
};

ChordDetector.prototype.scanVSTPlugins = async function() {
    if (!window.electronAPI) {
        this.status.textContent = 'VST functionality not available';
        this.status.className = 'status error';
        return;
    }

    this.status.textContent = 'Escaneando plugins VST...';
    this.status.className = 'status info';

    try {
        const plugins = await window.electronAPI.scanVSTPlugins();
        this.populateVSTPluginList(plugins);
        
        if (plugins.length > 0) {
            this.status.textContent = `Encontrados ${plugins.length} plugins VST`;
            this.status.className = 'status info';
        } else {
            this.status.textContent = 'No se encontraron plugins VST';
            this.status.className = 'status';
        }
    } catch (error) {
        this.status.textContent = `Error al escanear plugins VST: ${error.message}`;
        this.status.className = 'status error';
    }
};

ChordDetector.prototype.populateVSTPluginList = function(plugins) {
    this.vstPlugin.innerHTML = '<option value="">Selecciona un plugin VST...</option>';
    
    plugins.forEach(plugin => {
        const option = document.createElement('option');
        option.value = plugin.path;
        option.textContent = `${plugin.name} (${plugin.type})`;
        this.vstPlugin.appendChild(option);
    });
};

ChordDetector.prototype.onVSTPluginChange = async function() {
    const pluginPath = this.vstPlugin.value;
    
    if (!pluginPath) {
        // Hide GUI button when no plugin selected
        this.showVSTGUIBtn.classList.add('hidden');
        this.showVSTGUIBtn.disabled = true;
        return;
    }

    try {
        const pluginName = pluginPath.split(/[\\/]/).pop();
        this.status.textContent = `Cargando plugin VST: ${pluginName}`;
        this.status.className = 'status info';
        
        // Disable GUI button while loading
        this.showVSTGUIBtn.classList.add('hidden');
        this.showVSTGUIBtn.disabled = true;

        const success = await window.electronAPI.loadVSTPlugin(pluginPath);
        
        if (success) {
            this.status.textContent = `Plugin VST cargado: ${pluginName}`;
            this.status.className = 'status info';
            
            // Enable and show GUI button when plugin is loaded
            this.showVSTGUIBtn.classList.remove('hidden');
            this.showVSTGUIBtn.disabled = false;
            
            // If already running, restart with VST
            if (this.isRunning) {
                this.stopDetection();
                setTimeout(() => this.startDetection(), 500);
            }
        } else {
            this.status.textContent = 'Error al cargar el plugin VST';
            this.status.className = 'status error';
            this.showVSTGUIBtn.classList.add('hidden');
            this.showVSTGUIBtn.disabled = true;
        }
    } catch (error) {
        this.status.textContent = `Error al cargar plugin VST: ${error.message}`;
        this.status.className = 'status error';
        this.showVSTGUIBtn.classList.add('hidden');
        this.showVSTGUIBtn.disabled = true;
    }
};

ChordDetector.prototype.showVSTPluginGUI = async function() {
    if (!window.electronAPI) {
        this.status.textContent = 'VST functionality not available';
        this.status.className = 'status error';
        return;
    }

    try {
        // First check if a plugin is actually loaded
        const isLoaded = await window.electronAPI.isVSTPluginLoaded();
        if (!isLoaded) {
            this.status.textContent = 'No hay ningún plugin VST cargado';
            this.status.className = 'status error';
            return;
        }

        this.status.textContent = 'Abriendo interfaz del plugin VST...';
        this.status.className = 'status info';

        const success = await window.electronAPI.showVSTPluginGUI();
        
        if (success) {
            this.status.textContent = 'Interfaz VST abierta (modo simulación)';
            this.status.className = 'status info';
        } else {
            this.status.textContent = 'No se pudo abrir la interfaz VST';
            this.status.className = 'status error';
        }
    } catch (error) {
        this.status.textContent = `Error al abrir interfaz VST: ${error.message}`;
        this.status.className = 'status error';
    }
};

ChordDetector.prototype.startVSTProcessing = async function() {
    const pluginPath = this.vstPlugin.value;
    
    if (!pluginPath) {
        return false;
    }

    try {
        const success = await window.electronAPI.startVSTProcessing(pluginPath, 44100, 1024);
        return success;
    } catch (error) {
        console.error('Error starting VST processing:', error);
        return false;
    }
};

ChordDetector.prototype.stopVSTProcessing = async function() {
    try {
        await window.electronAPI.stopVSTProcessing();
    } catch (error) {
        console.error('Error stopping VST processing:', error);
    }
};

// Override startDetection to include VST support
ChordDetector.prototype.startDetection = async function() {
    const deviceId = this.audioInput.value;
    const vstPluginPath = this.vstPlugin.value;
    
    // If VST plugin is selected, use VST processing
    if (vstPluginPath) {
        const vstSuccess = await this.startVSTProcessing();
        if (vstSuccess) {
            this.status.textContent = 'Procesando audio desde plugin VST...';
            this.status.className = 'status info';
            // In VST mode, we don't use audioContext/analyser
            this.audioContext = null;
            this.analyser = null;
            this.isRunning = true;
            this.startBtn.classList.add('hidden');
            this.stopBtn.classList.remove('hidden');
            this.processAudio();
            return;
        }
    }
    
    // Fall back to regular audio device detection
    if (!deviceId) {
        this.status.textContent = 'Por favor selecciona un dispositivo de audio o plugin VST';
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
            // Check if audioContext still exists (might be null in VST mode)
            if (!this.audioContext) return;
            
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
};

// Override stopDetection to include VST cleanup
ChordDetector.prototype.stopDetection = function() {
    this.isRunning = false;
    
    if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
    }
    
    // Clean up VST processing
    this.stopVSTProcessing();
    
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
};

// Initialize the chord detector when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChordDetector();
});
