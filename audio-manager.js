class AudioManager {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.stream = null;
        this.isRunning = false;
        
        // BPM detection variables
        this.beatHistory = [];
        this.lastBeatTime = 0;
        this.bpm = 120;
        this.sampleInterval = 0;
        this.lastSampleTime = 0;
        
        // Improved detection variables
        this.previousSpectrum = null;
        this.onsetThreshold = 0.1;
        this.noiseFloor = 0.01;
        this.frameHistory = [];
        this.maxFrameHistory = 8;
        this.adaptiveThreshold = 0.02;
        this.spectralFluxHistory = [];
        this.lastOnsetTime = 0;
    }

    async loadAudioDevices(audioInput, audioOutput) {
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
                audioInput.appendChild(option);
            });
            
            // Load output devices
            audioOutputDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Dispositivo de salida ${audioOutputDevices.indexOf(device) + 1}`;
                audioOutput.appendChild(option);
            });
            
            return audioInputDevices.length > 0;
        } catch (error) {
            console.error('Error loading audio devices:', error);
            throw error;
        }
    }

    async startDetection(deviceId) {
        try {
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
            return true;
            
        } catch (error) {
            console.error('Error starting audio capture:', error);
            throw error;
        }
    }

    stopDetection() {
        this.isRunning = false;
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.analyser = null;
        this.source = null;
    }

    getAudioData() {
        if (!this.isRunning || !this.analyser) return null;
        
        const bufferLength = this.analyser.frequencyBinCount;
        const timeData = new Float32Array(bufferLength);
        const frequencyData = new Uint8Array(bufferLength);
        
        this.analyser.getFloatTimeDomainData(timeData);
        this.analyser.getByteFrequencyData(frequencyData);
        
        return { timeData, frequencyData, bufferLength };
    }

    detectBPM(audioData, currentTime) {
        // Calculate RMS energy in the audio signal
        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sumSquares / audioData.length);

        // Very low threshold for studio audio - maximum sensitivity
        let threshold = 0.005;
        
        // Beat detection with improved logic
        if (rms > threshold && currentTime - this.lastBeatTime > 80) {
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
                    
                    console.log(`BPM detected: ${this.bpm}, RMS: ${rms.toFixed(4)}, Beats: ${this.beatHistory.length}`);
                }
            }
        }
        
        // If no beats detected for a while, reset to default
        if (currentTime - this.lastBeatTime > 2000 && this.beatHistory.length > 0) {
            this.beatHistory = [];
            this.bpm = 120;
            this.sampleInterval = 0;
            console.log('BPM reset to default 120');
        }
        
        return this.bpm;
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
        const onsetThreshold = 0.5;
        
        const currentTime = performance.now();
        const onsetDetected = spectralFlux > onsetThreshold &&
                             currentTime - this.lastOnsetTime > 50;
        
        // Update previous spectrum
        this.previousSpectrum = [...frequencyData];
        
        if (onsetDetected) {
            this.lastOnsetTime = currentTime;
            console.log(`Onset detected: flux=${spectralFlux.toFixed(4)}`);
        }
        
        return onsetDetected;
    }
}