class BrowserChordDetector {
    constructor(audioManager) {
        this.audioManager = audioManager;
        
        // Detection parameters
        this.minConfidence = 0.75;
        this.chromaBuffer = [];
        this.maxChromaBuffer = 8;
        this.chordHistory = [];
        this.maxChordHistory = 10;
        
        // Chroma to note mapping
        this.chromaNotes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        
        // Spectral change detection
        this.previousChroma = new Array(12).fill(0);
        this.chromaChangeThreshold = 0.15;
        this.consecutiveChanges = 0;
        this.minConsecutiveChanges = 3;
        
        // Chord stabilization
        this.currentChord = null;
        this.chordConfidence = 0;
        this.chordStability = 0;
        this.minStability = 5;
        
        console.log("Browser chord detector initialized");
    }

    detectChord(audioData, frequencyData) {
        const currentTime = performance.now();
        
        try {
            // Calculate chroma manually from frequency data
            const chromaVector = this.calculateChromaFromFrequency(frequencyData);
            
            // Check for significant spectral change
            const hasSignificantChange = this.detectSpectralChange(chromaVector);
            
            // Only analyze if there's a significant change or we need to stabilize
            if (hasSignificantChange || this.chordStability < this.minStability) {
                const chord = this.analyzeChromaForChord(chromaVector, currentTime);
                
                if (chord && chord.confidence >= this.minConfidence) {
                    return this.stabilizeChord(chord, currentTime);
                }
            }
            
            // Return current chord if stable and no significant change
            if (this.currentChord && this.chordStability >= this.minStability) {
                return {
                    name: this.currentChord,
                    confidence: this.chordConfidence,
                    notes: this.getChordNotes(this.currentChord),
                    fullNotes: this.getFullNotes(this.currentChord),
                    stable: true
                };
            }
            
            return null;
            
        } catch (error) {
            console.error("Browser detector error:", error);
            return null;
        }
    }

    calculateChromaFromFrequency(frequencyData) {
        const chromaVector = new Array(12).fill(0);
        const sampleRate = this.audioManager.audioContext.sampleRate;
        const bufferLength = frequencyData.length;
        
        // Map frequency bins to chroma notes
        for (let i = 0; i < bufferLength; i++) {
            const frequency = i * sampleRate / (bufferLength * 2);
            const amplitude = frequencyData[i] / 255; // Normalize to 0-1
            
            if (frequency > 65 && frequency < 1000) { // Focus on musical range
                // Find chroma note for this frequency
                const noteIndex = this.frequencyToChromaIndex(frequency);
                if (noteIndex !== -1) {
                    chromaVector[noteIndex] += amplitude;
                }
            }
        }
        
        // Normalize chroma vector
        const maxValue = Math.max(...chromaVector);
        if (maxValue > 0) {
            for (let i = 0; i < 12; i++) {
                chromaVector[i] = chromaVector[i] / maxValue;
            }
        }
        
        return chromaVector;
    }

    frequencyToChromaIndex(frequency) {
        // Convert frequency to MIDI note number
        const midiNote = 69 + 12 * Math.log2(frequency / 440);
        const chromaIndex = Math.round(midiNote) % 12;
        return chromaIndex;
    }

    detectSpectralChange(currentChroma) {
        // Calculate chroma change using cosine similarity
        let dotProduct = 0;
        let magnitudeCurrent = 0;
        let magnitudePrevious = 0;
        
        for (let i = 0; i < 12; i++) {
            dotProduct += currentChroma[i] * this.previousChroma[i];
            magnitudeCurrent += currentChroma[i] * currentChroma[i];
            magnitudePrevious += this.previousChroma[i] * this.previousChroma[i];
        }
        
        magnitudeCurrent = Math.sqrt(magnitudeCurrent);
        magnitudePrevious = Math.sqrt(magnitudePrevious);
        
        let similarity = 0;
        if (magnitudeCurrent > 0 && magnitudePrevious > 0) {
            similarity = dotProduct / (magnitudeCurrent * magnitudePrevious);
        }
        
        const change = 1 - similarity;
        
        // Update consecutive changes counter
        if (change > this.chromaChangeThreshold) {
            this.consecutiveChanges++;
        } else {
            this.consecutiveChanges = Math.max(0, this.consecutiveChanges - 1);
        }
        
        // Update previous chroma
        this.previousChroma = [...currentChroma];
        
        // Significant change detected if we have enough consecutive changes
        return this.consecutiveChanges >= this.minConsecutiveChanges;
    }

    analyzeChromaForChord(chromaVector, currentTime) {
        // Normalize chroma vector
        const maxValue = Math.max(...chromaVector);
        if (maxValue === 0) return null;
        
        const normalizedChroma = chromaVector.map(value => value / maxValue);
        
        // Find dominant notes with adaptive threshold
        const dominantNotes = this.findDominantNotes(normalizedChroma);
        
        if (dominantNotes.length < 2) {
            return null;
        }
        
        // Identify chord using our chord detection
        const chord = this.identifyChord(dominantNotes, normalizedChroma);
        
        if (chord && chord.confidence >= this.minConfidence) {
            // Add to chroma buffer for temporal analysis
            this.addToChromaBuffer(chord, currentTime);
            
            return chord;
        }
        
        return null;
    }

    findDominantNotes(normalizedChroma) {
        // Calculate adaptive threshold based on chroma distribution
        const sortedChroma = [...normalizedChroma].sort((a, b) => b - a);
        const adaptiveThreshold = Math.max(0.25, sortedChroma[2] * 0.8); // Use 3rd strongest as reference
        
        const dominantIndices = [];
        
        for (let i = 0; i < normalizedChroma.length; i++) {
            if (normalizedChroma[i] >= adaptiveThreshold) {
                dominantIndices.push(i);
            }
        }
        
        // If too many notes, take strongest ones
        if (dominantIndices.length > 6) {
            dominantIndices.sort((a, b) => normalizedChroma[b] - normalizedChroma[a]);
            dominantIndices.splice(6);
        }
        
        // Convert indices to note names
        return dominantIndices.map(index => this.chromaNotes[index]);
    }

    identifyChord(dominantNotes, chromaVector) {
        try {
            // Use our chord detection logic
            const detectedChords = this.detectChordsFromNotes(dominantNotes);
            
            if (detectedChords && detectedChords.length > 0) {
                // Score each possible chord
                const chordScores = detectedChords.map(chordName => {
                    const chordNotes = this.getChordNotes(chordName);
                    
                    // Calculate chroma match
                    const chromaMatch = this.calculateChromaMatch(chordNotes, chromaVector);
                    
                    // Calculate note match
                    const matchingNotes = dominantNotes.filter(note => chordNotes.includes(note));
                    const noteMatch = matchingNotes.length / Math.max(chordNotes.length, dominantNotes.length);
                    
                    // Combined confidence
                    const confidence = Math.min(
                        (chromaMatch * 0.7) + (noteMatch * 0.3),
                        0.95
                    );
                    
                    return {
                        name: chordName,
                        confidence: confidence,
                        notes: dominantNotes,
                        chromaMatch: chromaMatch,
                        noteMatch: noteMatch
                    };
                });
                
                // Return best chord
                chordScores.sort((a, b) => b.confidence - a.confidence);
                const bestChord = chordScores[0];
                
                if (bestChord.confidence >= this.minConfidence) {
                    // Add full notes for display
                    bestChord.fullNotes = dominantNotes.map(note => ({
                        note: note,
                        octave: 4,
                        frequency: this.noteToFrequency(note, 4),
                        confidence: 0.8
                    }));
                    
                    return bestChord;
                }
            }
        } catch (error) {
            console.warn("Chord identification error:", error);
        }
        
        return null;
    }

    detectChordsFromNotes(notes) {
        // Simple chord detection based on common chord patterns
        const chordPatterns = {
            // Major chords
            'C,E,G': 'C',
            'C#,F,G#': 'C#',
            'D,F#,A': 'D',
            'D#,G,A#': 'D#',
            'E,G#,B': 'E',
            'F,A,C': 'F',
            'F#,A#,C#': 'F#',
            'G,B,D': 'G',
            'G#,C,D#': 'G#',
            'A,C#,E': 'A',
            'A#,D,F': 'A#',
            'B,D#,F#': 'B',
            
            // Minor chords
            'C,Eb,G': 'Cm',
            'C#,E,G#': 'C#m',
            'D,F,A': 'Dm',
            'D#,F#,A#': 'D#m',
            'E,G,B': 'Em',
            'F,Ab,C': 'Fm',
            'F#,A,C#': 'F#m',
            'G,Bb,D': 'Gm',
            'G#,B,D#': 'G#m',
            'A,C,E': 'Am',
            'A#,C#,F': 'A#m',
            'B,D,F#': 'Bm'
        };
        
        const noteString = notes.join(',');
        
        // Check for exact matches
        if (chordPatterns[noteString]) {
            return [chordPatterns[noteString]];
        }
        
        // Check for partial matches
        const possibleChords = [];
        for (const pattern in chordPatterns) {
            const patternNotes = pattern.split(',');
            const matchingNotes = notes.filter(note => patternNotes.includes(note));
            
            if (matchingNotes.length >= 2) {
                possibleChords.push(chordPatterns[pattern]);
            }
        }
        
        return possibleChords;
    }

    calculateChromaMatch(chordNotes, chromaVector) {
        // Create ideal chroma vector for this chord
        const idealChroma = new Array(12).fill(0);
        
        chordNotes.forEach(note => {
            const noteIndex = this.chromaNotes.indexOf(note);
            if (noteIndex !== -1) {
                idealChroma[noteIndex] = 1.0;
            }
        });
        
        // Calculate cosine similarity
        let dotProduct = 0;
        let magnitudeActual = 0;
        let magnitudeIdeal = 0;
        
        for (let i = 0; i < 12; i++) {
            dotProduct += chromaVector[i] * idealChroma[i];
            magnitudeActual += chromaVector[i] * chromaVector[i];
            magnitudeIdeal += idealChroma[i] * idealChroma[i];
        }
        
        magnitudeActual = Math.sqrt(magnitudeActual);
        magnitudeIdeal = Math.sqrt(magnitudeIdeal);
        
        if (magnitudeActual === 0 || magnitudeIdeal === 0) {
            return 0;
        }
        
        return Math.max(0, dotProduct / (magnitudeActual * magnitudeIdeal));
    }

    addToChromaBuffer(chord, currentTime) {
        this.chromaBuffer.push({
            chord: chord.name,
            confidence: chord.confidence,
            timestamp: currentTime
        });
        
        // Keep buffer size limited
        if (this.chromaBuffer.length > this.maxChromaBuffer) {
            this.chromaBuffer.shift();
        }
    }

    stabilizeChord(newChord, currentTime) {
        // Count occurrences of this chord in recent buffer
        const recentBuffer = this.chromaBuffer.filter(item => 
            currentTime - item.timestamp < 1000 // Last second
        );
        
        const chordCounts = new Map();
        for (const item of recentBuffer) {
            chordCounts.set(item.chord, (chordCounts.get(item.chord) || 0) + item.confidence);
        }
        
        const currentChordScore = chordCounts.get(newChord.name) || 0;
        const totalScore = Array.from(chordCounts.values()).reduce((sum, score) => sum + score, 0);
        
        if (totalScore === 0) return newChord;
        
        const dominanceRatio = currentChordScore / totalScore;
        
        // Update chord stability
        if (newChord.name === this.currentChord) {
            this.chordStability = Math.min(this.chordStability + 1, 20);
            this.chordConfidence = Math.max(this.chordConfidence, newChord.confidence);
        } else {
            // Chord changed
            if (dominanceRatio >= 0.6) {
                this.currentChord = newChord.name;
                this.chordStability = 1;
                this.chordConfidence = newChord.confidence;
                this.consecutiveChanges = 0; // Reset change counter
            } else {
                // Not dominant enough, keep current chord
                return {
                    name: this.currentChord,
                    confidence: this.chordConfidence,
                    notes: this.getChordNotes(this.currentChord),
                    fullNotes: this.getFullNotes(this.currentChord),
                    stable: true
                };
            }
        }
        
        return newChord;
    }

    getChordNotes(chordName) {
        // Simple chord note mapping
        const chordMap = {
            // Major chords
            'C': ['C', 'E', 'G'],
            'C#': ['C#', 'F', 'G#'],
            'D': ['D', 'F#', 'A'],
            'D#': ['D#', 'G', 'A#'],
            'E': ['E', 'G#', 'B'],
            'F': ['F', 'A', 'C'],
            'F#': ['F#', 'A#', 'C#'],
            'G': ['G', 'B', 'D'],
            'G#': ['G#', 'C', 'D#'],
            'A': ['A', 'C#', 'E'],
            'A#': ['A#', 'D', 'F'],
            'B': ['B', 'D#', 'F#'],
            
            // Minor chords
            'Cm': ['C', 'Eb', 'G'],
            'C#m': ['C#', 'E', 'G#'],
            'Dm': ['D', 'F', 'A'],
            'D#m': ['D#', 'F#', 'A#'],
            'Em': ['E', 'G', 'B'],
            'Fm': ['F', 'Ab', 'C'],
            'F#m': ['F#', 'A', 'C#'],
            'Gm': ['G', 'Bb', 'D'],
            'G#m': ['G#', 'B', 'D#'],
            'Am': ['A', 'C', 'E'],
            'A#m': ['A#', 'C#', 'F'],
            'Bm': ['B', 'D', 'F#']
        };
        
        return chordMap[chordName] || [chordName.replace(/m$/, '')];
    }

    getFullNotes(chordName) {
        const notes = this.getChordNotes(chordName);
        return notes.map(note => ({
            note: note,
            octave: 4,
            frequency: this.noteToFrequency(note, 4),
            confidence: 0.8
        }));
    }

    noteToFrequency(noteName, octave) {
        // Convert note name to frequency
        const noteFrequencies = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
            'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88,
            'Eb': 311.13, 'Ab': 415.30, 'Bb': 466.16
        };
        
        return noteFrequencies[noteName] || 440;
    }

    // Reset detector state
    reset() {
        this.currentChord = null;
        this.chordConfidence = 0;
        this.chordStability = 0;
        this.consecutiveChanges = 0;
        this.chromaBuffer = [];
        this.previousChroma = new Array(12).fill(0);
    }
}
