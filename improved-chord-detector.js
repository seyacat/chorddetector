class ImprovedChordDetector {
    constructor(audioManager) {
        this.audioManager = audioManager;
        // Eliminar análisis temporal para respuesta inmediata
    }

    detectChord(audioData, frequencyData) {
        console.log("Improved detector: Starting detection...");
        
        // Análisis espectral inmediato sin temporal
        const spectralAnalysis = this.enhancedSpectralAnalysis(frequencyData);
        
        console.log("Improved detector: Found", spectralAnalysis.peaks.length, "spectral peaks");
        
        if (spectralAnalysis.peaks.length === 0) {
            console.log("Improved detector: No peaks found");
            return null;
        }
        
        // Usar directamente los picos más fuertes como notas
        const notes = this.peaksToNotes(spectralAnalysis.peaks);
        
        console.log("Improved detector: Converted to notes:", notes.map(n => n.note));
        
        // Identificación de acordes mejorada
        const chord = this.improvedChordIdentification(notes);
        
        console.log("Improved detector: Chord identified:", chord);
        
        return chord;
    }

    enhancedSpectralAnalysis(frequencyData) {
        const sampleRate = this.audioManager.audioContext.sampleRate;
        const bufferLength = frequencyData.length;
        
        console.log("Improved detector: Sample rate:", sampleRate, "Buffer length:", bufferLength);
        
        // Encontrar picos espectrales con criterios muy simples
        const peaks = this.findSpectralPeaks(frequencyData, sampleRate, bufferLength);
        
        return {
            peaks: peaks,
            sampleRate: sampleRate,
            bufferLength: bufferLength
        };
    }

    findSpectralPeaks(data, sampleRate, bufferLength) {
        const peaks = [];
        const amplitudeThreshold = 5; // Umbral extremadamente bajo
        
        console.log("Improved detector: Looking for peaks in data of length", data.length);
        
        // Mostrar algunos valores de datos para depuración
        if (data.length > 10) {
            console.log("Improved detector: First 10 data values:", Array.from(data.slice(0, 10)));
        }
        
        for (let i = 1; i < bufferLength - 1; i++) {
            const current = data[i];
            
            // Criterio de pico muy simple
            if (current > data[i-1] && current > data[i+1] &&
                current > amplitudeThreshold) {
                
                const frequency = i * sampleRate / (bufferLength * 2);
                
                // Rango de frecuencia muy amplio
                if (frequency > 20 && frequency < 3000) {
                    peaks.push({
                        frequency: frequency,
                        amplitude: current,
                        bin: i
                    });
                }
            }
        }
        
        // Ordenar por amplitud
        peaks.sort((a, b) => b.amplitude - a.amplitude);
        
        console.log("Improved detector: Top 3 peaks:", peaks.slice(0, 3).map(p => ({freq: p.frequency.toFixed(1), amp: p.amplitude})));
        
        return peaks.slice(0, 8); // Limitar a los 8 picos más fuertes
    }

    peaksToNotes(peaks) {
        const notes = [];
        const A4 = 440;
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        
        for (const peak of peaks) {
            const noteNumber = 12 * (Math.log2(peak.frequency / A4));
            const noteIndex = Math.round(noteNumber) % 12;
            const octave = Math.floor(noteNumber / 12) + 4;
            
            notes.push({
                note: noteNames[(noteIndex + 12) % 12],
                octave: octave,
                frequency: peak.frequency,
                amplitude: peak.amplitude
            });
        }
        
        return notes;
    }

    improvedChordIdentification(notes) {
        if (notes.length < 1) {
            return null;
        }
        
        // Extraer solo los nombres de notas únicos
        const uniqueNotes = [...new Set(notes.map(n => n.note))].sort();
        
        console.log("Improved detector: Unique notes:", uniqueNotes);
        
        // Intentar identificar acorde por patrones de intervalos
        const chordByIntervals = this.identifyChordByIntervals(uniqueNotes);
        if (chordByIntervals) {
            return chordByIntervals;
        }
        
        // Intentar identificar acorde por coincidencia directa
        const chordByPattern = this.identifyChordByPattern(uniqueNotes);
        if (chordByPattern) {
            return chordByPattern;
        }
        
        // Si no se puede identificar un acorde, usar la nota más fuerte como acorde principal
        // pero mantener todas las notas para mostrar
        const strongestNote = notes.reduce((strongest, current) => 
            current.amplitude > strongest.amplitude ? current : strongest
        );
        
        return {
            name: strongestNote.note,
            confidence: 0.4,
            notes: uniqueNotes
        };
    }

    identifyChordByIntervals(notes) {
        if (notes.length < 3) return null;
        
        // Convertir notas a semitonos
        const semitones = this.notesToSemitones(notes);
        
        // Buscar patrones de acordes comunes
        const chordPatterns = [
            // Mayor: 0, 4, 7
            { pattern: [0, 4, 7], type: '', confidence: 0.9 },
            // Menor: 0, 3, 7
            { pattern: [0, 3, 7], type: 'm', confidence: 0.9 },
            // Mayor 7: 0, 4, 7, 11
            { pattern: [0, 4, 7, 11], type: 'maj7', confidence: 0.8 },
            // Menor 7: 0, 3, 7, 10
            { pattern: [0, 3, 7, 10], type: 'm7', confidence: 0.8 },
            // Dominante 7: 0, 4, 7, 10
            { pattern: [0, 4, 7, 10], type: '7', confidence: 0.8 },
            // Sus2: 0, 2, 7
            { pattern: [0, 2, 7], type: 'sus2', confidence: 0.7 },
            // Sus4: 0, 5, 7
            { pattern: [0, 5, 7], type: 'sus4', confidence: 0.7 }
        ];
        
        // Probar cada posible nota raíz
        for (let rootIndex = 0; rootIndex < semitones.length; rootIndex++) {
            const rootNote = semitones[rootIndex];
            
            // Calcular intervalos relativos a la nota raíz
            const intervals = semitones.map(semitone => (semitone - rootNote + 12) % 12).sort((a, b) => a - b);
            
            // Verificar contra patrones de acordes
            for (const pattern of chordPatterns) {
                const matchingIntervals = pattern.pattern.filter(interval => intervals.includes(interval));
                const matchRatio = matchingIntervals.length / pattern.pattern.length;
                
                // Si tenemos una coincidencia fuerte
                if (matchRatio >= 0.75) {
                    const rootNoteName = this.semitoneToNoteName(rootNote % 12);
                    return {
                        name: rootNoteName + pattern.type,
                        confidence: pattern.confidence * matchRatio,
                        notes: notes
                    };
                }
            }
        }
        
        return null;
    }

    identifyChordByPattern(uniqueNotes) {
        // Patrones de acordes muy simples
        const chordPatterns = {
            // Mayor
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
            
            // Minor
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
            'B,D,F#': 'Bm',
            
            // 7th chords
            'C,E,G,Bb': 'C7',
            'D,F#,A,C': 'D7',
            'E,G#,B,D': 'E7',
            'F,A,C,Eb': 'F7',
            'G,B,D,F': 'G7',
            'A,C#,E,G': 'A7',
            'B,D#,F#,A': 'B7'
        };
        
        const noteString = uniqueNotes.join(',');
        
        // Coincidencia exacta
        if (chordPatterns[noteString]) {
            return {
                name: chordPatterns[noteString],
                confidence: 0.9,
                notes: uniqueNotes
            };
        }
        
        // Coincidencia parcial (al menos 3 de 4 notas para acordes de 4 notas, 2 de 3 para triadas)
        for (const pattern in chordPatterns) {
            const patternNotes = pattern.split(',');
            const matchingNotes = uniqueNotes.filter(note => patternNotes.includes(note));
            
            const minRequired = patternNotes.length === 4 ? 3 : 2;
            
            if (matchingNotes.length >= minRequired) {
                const matchRatio = matchingNotes.length / patternNotes.length;
                return {
                    name: chordPatterns[pattern],
                    confidence: 0.7 * matchRatio,
                    notes: uniqueNotes
                };
            }
        }
        
        return null;
    }

    notesToSemitones(notes) {
        const noteMap = {
            'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
            'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
            'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
        };
        
        return notes.map(note => noteMap[note]);
    }

    semitoneToNoteName(semitone) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return noteNames[semitone];
    }
}
