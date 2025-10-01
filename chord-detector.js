class ChordDetector {
    constructor(audioManager) {
        this.audioManager = audioManager;
    }

    detectChord(audioData, frequencyData) {
        // Improved onset detection for studio-quality audio
        const hasOnset = this.audioManager.detectOnset(frequencyData);
        
        // For studio recordings, use fixed high sensitivity threshold
        this.audioManager.adaptiveThreshold = 0.01;
        
        // Always analyze when onset is detected, otherwise sample based on BPM
        const currentTime = performance.now();
        const shouldAnalyze = hasOnset || this.audioManager.shouldSample(currentTime);
        
        if (!shouldAnalyze) {
            return null;
        }
        
        // Find fundamental frequencies using improved harmonic analysis
        const fundamentals = this.findFundamentalFrequencies(frequencyData);
        
        // Convert frequencies to notes with octave information
        const notesWithOctaves = fundamentals.map(freq => this.frequencyToNoteWithOctave(freq));
        
        // Enhanced chord detection with temporal analysis
        return this.identifyChordWithTemporalAnalysis(notesWithOctaves, fundamentals);
    }

    findFundamentalFrequencies(frequencyData) {
        const peaks = [];
        const sampleRate = this.audioManager.audioContext.sampleRate;
        const bufferLength = frequencyData.length;
        
        // Fixed high sensitivity threshold for studio audio (much lower)
        const amplitudeThreshold = 16;
        
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
                if (frequency > 50 && frequency < 1500) {
                    // Calculate peak prominence
                    const leftMin = Math.min(prev1, prev2);
                    const rightMin = Math.min(next1, next2);
                    const prominence = current - Math.max(leftMin, rightMin);
                    
                    // Include even weak peaks for studio audio
                    if (prominence > 8) {
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
        for (let i = 0; i < peaks.length && fundamentals.length < 8; i++) {
            const peak = peaks[i];
            let isHarmonic = false;
            
            // Check if this peak is a harmonic of an existing fundamental
            for (let j = 0; j < fundamentals.length; j++) {
                const fundamental = fundamentals[j];
                const ratio = peak.frequency / fundamental.frequency;
                
                // More permissive harmonic detection for studio audio
                if (Math.abs(ratio - Math.round(ratio)) < 0.1) {
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
}