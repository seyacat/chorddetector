class RealTimeChordDetector {
    constructor(audioManager) {
        this.audioManager = audioManager;
        
        // Meyda for real-time chroma analysis
        this.meyda = require('meyda');
        
        // Tonal.js for chord detection
        this.chordDetect = require('@tonaljs/chord-detect');
        this.chord = require('@tonaljs/chord');
        this.note = require('@tonaljs/note');
        
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
        
        console.log("Real-time chord detector initialized");
    }

    detectChord(audioData, frequencyData) {
        const currentTime = performance.now();
        
        try {
            // Extract chroma features using Meyda
            const features = this.meyda.extract([
                'chroma',
                'spectralCentroid',
                'rms',
                'spectralRolloff'
            ], audioData, frequencyData);
            
            if (!features || !features.chroma) {
                return null;
            }
            
            // Check for significant spectral change
            const hasSignificantChange = this.detectSpectralChange(features.chroma);
            
            // Only analyze if there's a significant change or we need to stabilize
            if (hasSignificantChange || this.chordStability < this.minStability) {
                const chord = this.analyzeChromaForChord(features.chroma, currentTime);
                
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
            console.error("Real-time detector error:", error);
            return null;
        }
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
        
        // Identify chord using tonal.js
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
            const detectedChords = this.chordDetect.detect(dominantNotes);
            
            if (detectedChords && detectedChords.length > 0) {
                // Score each possible chord
                const chordScores = detectedChords.map(chordName => {
                    const chordObj = this.chord.get(chordName);
                    const chordNotes = chordObj.notes || [];
                    
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
        try {
            const chordObj = this.chord.get(chordName);
            return chordObj.notes || [chordName.replace(/m$/, '')]; // Remove 'm' for minor chords
        } catch (error) {
            return [chordName];
        }
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
        try {
            const fullNote = `${noteName}${octave}`;
            const freq = this.note.freq(fullNote);
            return freq || 440;
        } catch (error) {
            return 440;
        }
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

module.exports = RealTimeChordDetector;
