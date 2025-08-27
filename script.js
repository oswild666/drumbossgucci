document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const patternsContainer = document.querySelector('.patterns-container');
    const playStopButton = document.getElementById('play-stop');
    const restartButton = document.getElementById('restart');
    const bpmInput = document.getElementById('bpm');
    const swingSlider = document.getElementById('swing');
    const swingValueDisplay = document.getElementById('swing-value');

    // --- Audio & Sequencer State ---
    let audioContext;
    let masterGain;
    let saturator;
    let isPlaying = false;
    let currentStep = 0;
    let lastDrawStep = -1;
    let bpm = 120;
    let swing = 0.5;
    let nextStepTime = 0.0;
    let schedulerTimerID;
    let uiTimerID;

    // --- Pattern Data Structure ---
    const NUM_PATTERNS = 7;
    const NUM_STEPS = 64;
    const patterns = [];
    let noiseBuffer = null;

    // --- Synth Parameters State ---
    const synthParams = {
        kick: { decay: 0.5, startPitch: 150, endPitch: 40, fmAmount: 250 },
        snare: { toneDecay: 0.1, noiseDecay: 0.2, noiseFilterFreq: 1500, balance: 0.5 },
        hat: { closedDecay: 0.05, openDecay: 0.4, filterFreq: 7000 },
        clap: { decay: 0.2, spread: 0.008 },
        tom: { decay: 0.3, startPitch: 400, endPitch: 200 },
        mainSynth: {
            oscillators: [
                { pitch: 0 }, // OSC 1
                { pitch: 0, fmDepth: 100 }, // OSC 2
                { pitch: 0, rmDepth: 0.5 }, // OSC 3
                { pitch: 0 }, // OSC 4
                { pitch: 0, fmDepth: 100 }, // OSC 5
                { pitch: 0, rmDepth: 0.5 }, // OSC 6
            ],
            decay: 0.5,
            chordMode: false,
            chordType: 'Maj',
            inversion: 0
        }
    };

    // --- Sound Synthesis ---

    const CHORD_MAP = {
        'Maj': [0, 4, 7],
        'min': [0, 3, 7],
        'dim': [0, 3, 6],
        'aug': [0, 4, 8],
        'Maj7': [0, 4, 7, 11],
        'min7': [0, 3, 7, 10],
        'dom7': [0, 4, 7, 10],
        'dim7': [0, 3, 6, 9],
        'm7b5': [0, 3, 6, 10], // Half-diminished
        'sus2': [0, 2, 7],
        'sus4': [0, 5, 7],
        'Maj6': [0, 4, 7, 9],
        'min6': [0, 3, 7, 9],
        'add9': [0, 4, 7, 14],
        'madd9': [0, 3, 7, 14],
        '7sus4': [0, 5, 7, 10],
        'Maj9': [0, 4, 7, 11, 14],
        'min9': [0, 3, 7, 10, 14],
        'dom9': [0, 4, 7, 10, 14],
        'dom11': [0, 4, 7, 10, 14, 17],
        'dom13': [0, 4, 7, 10, 14, 21],
        'Maj_triad_2nd_inv': [0, 5, 9],
        'min_triad_2nd_inv': [0, 5, 8],
        'quartal': [0, 5, 10],
        'quintal': [0, 7, 14],
    };

    function makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        let i = 0;
        let x;
        for ( ; i < n_samples; ++i ) {
            x = i * 2 / n_samples - 1;
            curve[i] = ( 3 + k ) * x * 20 * deg / ( Math.PI + k * Math.abs(x) );
        }
        return curve;
    }

    function noteToFreq(note) {
        const notes = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
        const octave = parseInt(note.slice(-1), 10);
        const key = note.slice(0, -1);
        const semitone = notes[key];
        return 440 * Math.pow(2, (octave - 4) + (semitone - 9) / 12);
    }

    function createSynthNote(rootNote, time) {
        if (!audioContext) return;

        const synthSettings = synthParams.mainSynth;
        let notesToPlay = [rootNote];

        // If chord mode is active, calculate the notes of the chord
        if (synthSettings.chordMode && CHORD_MAP[synthSettings.chordType]) {
            let intervals = CHORD_MAP[synthSettings.chordType];

            // Apply Inversion
            for (let i = 0; i < synthSettings.inversion; i++) {
                if (intervals.length > 1) {
                    const first = intervals.shift();
                    intervals.push(first + 12);
                }
            }

            const rootOctave = parseInt(rootNote.slice(-1), 10);
            const rootKey = rootNote.slice(0, -1);

            // This is a simplified note calculation, a proper library would be better
            const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const rootIndex = noteNames.indexOf(rootKey);

            notesToPlay = intervals.map(interval => {
                const noteIndex = (rootIndex + interval);
                const octave = rootOctave + Math.floor(noteIndex / 12);
                return noteNames[noteIndex % 12] + octave;
            });
        }

        notesToPlay.forEach(noteString => playSingleSynthVoice(noteString, time));
    }

    function playSingleSynthVoice(note, time) {
        const params = synthParams.mainSynth;
        const baseFreq = noteToFreq(note);

        const noteGain = audioContext.createGain();
        noteGain.connect(masterGain);
        noteGain.gain.setValueAtTime(0.3 / 3, time); // Reduce gain per note to avoid clipping
        noteGain.gain.exponentialRampToValueAtTime(0.01, time + params.decay);

        function semitoneToRatio(semitones) {
            return Math.pow(2, semitones / 12);
        }

        // The full 6-oscillator logic for a single note
        const group1 = { osc1: audioContext.createOscillator(), osc2: audioContext.createOscillator(), osc3: audioContext.createOscillator(), fmGain: audioContext.createGain(), rmGain: audioContext.createGain() };
        group1.osc1.connect(group1.fmGain);
        group1.fmGain.connect(group1.osc2.frequency);
        group1.osc2.connect(group1.rmGain);
        group1.osc3.connect(group1.rmGain.gain);
        group1.rmGain.connect(noteGain);
        group1.osc1.frequency.value = baseFreq * semitoneToRatio(params.oscillators[0].pitch);
        group1.osc2.frequency.value = baseFreq * semitoneToRatio(params.oscillators[1].pitch);
        group1.osc3.frequency.value = baseFreq * semitoneToRatio(params.oscillators[2].pitch);
        group1.fmGain.gain.value = params.oscillators[1].fmDepth;
        group1.rmGain.gain.value = params.oscillators[2].rmDepth;

        const group2 = { osc4: audioContext.createOscillator(), osc5: audioContext.createOscillator(), osc6: audioContext.createOscillator(), fmGain: audioContext.createGain(), rmGain: audioContext.createGain() };
        group2.osc4.connect(group2.fmGain);
        group2.fmGain.connect(group2.osc5.frequency);
        group2.osc5.connect(group2.rmGain);
        group2.osc6.connect(group2.rmGain.gain);
        group2.rmGain.connect(noteGain);
        group2.osc4.frequency.value = baseFreq * semitoneToRatio(params.oscillators[3].pitch);
        group2.osc5.frequency.value = baseFreq * semitoneToRatio(params.oscillators[4].pitch);
        group2.osc6.frequency.value = baseFreq * semitoneToRatio(params.oscillators[5].pitch);
        group2.fmGain.gain.value = params.oscillators[4].fmDepth;
        group2.rmGain.gain.value = params.oscillators[5].rmDepth;

        const allOscs = [group1.osc1, group1.osc2, group1.osc3, group2.osc4, group2.osc5, group2.osc6];
        allOscs.forEach(osc => {
            osc.start(time);
            osc.stop(time + params.decay);
        });
    }

    function createNoiseBuffer() {
        if (!audioContext) return;
        const bufferSize = audioContext.sampleRate * 2; // 2 seconds of noise
        const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
        const output = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    function createSnare(time) {
        if (!audioContext) return;
        const params = synthParams.snare;
        const totalDecay = Math.max(params.toneDecay, params.noiseDecay);

        const masterSnareGain = audioContext.createGain();
        masterSnareGain.connect(masterGain);

        // Noise component
        const noiseSource = audioContext.createBufferSource();
        noiseSource.buffer = noiseBuffer;

        const noiseFilter = audioContext.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = params.noiseFilterFreq;

        const noiseGain = audioContext.createGain();
        noiseGain.gain.value = 1.0 - params.balance; // Controlled by balance
        noiseGain.gain.setValueAtTime(noiseGain.gain.value, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + params.noiseDecay);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterSnareGain);

        // Tonal component
        const bodyOsc = audioContext.createOscillator();
        bodyOsc.type = 'triangle';
        bodyOsc.frequency.setValueAtTime(200, time);
        bodyOsc.frequency.exponentialRampToValueAtTime(100, time + params.toneDecay);

        const bodyGain = audioContext.createGain();
        bodyGain.gain.value = params.balance; // Controlled by balance
        bodyGain.gain.setValueAtTime(bodyGain.gain.value, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.01, time + params.toneDecay);

        bodyOsc.connect(bodyGain);
        bodyGain.connect(masterSnareGain);

        // Start and stop
        noiseSource.start(time);
        noiseSource.stop(time + totalDecay);
        bodyOsc.start(time);
        bodyOsc.stop(time + totalDecay);
    }

    function createHat(time, type = 'closed') {
        if (!audioContext) return;
        const params = synthParams.hat;
        const decayTime = type === 'closed' ? params.closedDecay : params.openDecay;

        const gain = audioContext.createGain();
        gain.connect(masterGain);
        gain.gain.setValueAtTime(0.5, time); // Lower volume for hats
        gain.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

        const highpass = audioContext.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = params.filterFreq;
        highpass.connect(gain);

        const noiseSource = audioContext.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.connect(highpass);

        noiseSource.start(time);
        noiseSource.stop(time + decayTime);
    }

    function createClap(time) {
        if (!audioContext) return;
        const params = synthParams.clap;

        const masterClapGain = audioContext.createGain();
        masterClapGain.connect(masterGain);
        masterClapGain.gain.value = 0.6; // Claps can be loud

        // The "tail" of the clap
        const tailGain = audioContext.createGain();
        tailGain.gain.setValueAtTime(1, time);
        tailGain.gain.exponentialRampToValueAtTime(0.01, time + params.decay);

        const tailFilter = audioContext.createBiquadFilter();
        tailFilter.type = 'bandpass';
        tailFilter.frequency.value = 1200;
        tailFilter.Q.value = 5;
        tailFilter.connect(tailGain);
        tailGain.connect(masterClapGain);

        const tailSource = audioContext.createBufferSource();
        tailSource.buffer = noiseBuffer;
        tailSource.connect(tailFilter);
        tailSource.start(time);
        tailSource.stop(time + params.decay);

        // The short, sharp "slaps"
        const slapDelays = [0, params.spread, params.spread * 2]; // Dynamic spread
        slapDelays.forEach(delay => {
            const slapGain = audioContext.createGain();
            slapGain.gain.setValueAtTime(1, time + delay);
            slapGain.gain.exponentialRampToValueAtTime(0.01, time + delay + 0.02);

            const slapSource = audioContext.createBufferSource();
            slapSource.buffer = noiseBuffer;
            slapSource.connect(slapGain);
            slapGain.connect(masterClapGain);

            slapSource.start(time + delay);
            slapSource.stop(time + delay + 0.02);
        });
    }

    function createTom(time) {
        if (!audioContext) return;
        const params = synthParams.tom;
        const decayTime = params.decay;

        const ampEnvelope = audioContext.createGain();
        ampEnvelope.connect(masterGain);
        ampEnvelope.gain.setValueAtTime(1.0, time);
        ampEnvelope.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

        const osc = audioContext.createOscillator();
        osc.type = 'triangle';
        osc.connect(ampEnvelope);

        osc.frequency.setValueAtTime(params.startPitch, time);
        osc.frequency.exponentialRampToValueAtTime(params.endPitch, time + 0.2); // Faster pitch sweep for toms

        osc.start(time);
        osc.stop(time + decayTime);
    }

    function createKick(time) {
        if (!audioContext) return;
        const params = synthParams.kick;
        const decayTime = params.decay;

        const ampEnvelope = audioContext.createGain();
        ampEnvelope.connect(masterGain);
        ampEnvelope.gain.setValueAtTime(1.0, time);
        ampEnvelope.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

        const carrier = audioContext.createOscillator();
        carrier.type = 'triangle';
        carrier.connect(ampEnvelope);

        carrier.frequency.setValueAtTime(params.startPitch, time);
        carrier.frequency.exponentialRampToValueAtTime(params.endPitch, time + 0.15);

        const modulator = audioContext.createOscillator();
        modulator.type = 'triangle';
        modulator.frequency.setValueAtTime(100, time); // Can also be a parameter

        const modulatorGain = audioContext.createGain();
        modulatorGain.gain.setValueAtTime(params.fmAmount, time);
        modulatorGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        modulator.connect(modulatorGain);
        modulatorGain.connect(carrier.frequency);

        carrier.start(time);
        carrier.stop(time + decayTime);
        modulator.start(time);
        modulator.stop(time + decayTime);
    }

    // --- UI Generation & Handling ---
    function createPatternGrid() {
        for (let p = 0; p < NUM_PATTERNS; p++) {
            const row = document.createElement('div');
            row.classList.add('pattern-row');
            for (let s = 0; s < NUM_STEPS; s++) {
                const step = document.createElement('div');
                step.classList.add('step');
                step.dataset.pattern = p;
                step.dataset.step = s;
                // For synth track, check for non-zero/null/undefined value
                if ((p === 6 && patterns[p][s]) || (p < 6 && patterns[p][s] === 1)) {
                    step.classList.add('active');
                }
                row.appendChild(step);
            }
            patternsContainer.appendChild(row);
        }
    }

    function handleStepClick(event) {
        if (!event.target.classList.contains('step')) return;

        const pattern = parseInt(event.target.dataset.pattern, 10);
        const step = parseInt(event.target.dataset.step, 10);

        // Disable note editing for synth track for now, as it's more complex
        if (pattern < 6) {
            patterns[pattern][step] = patterns[pattern][step] === 1 ? 0 : 1;
            event.target.classList.toggle('active');
        }
    }

    function updateUI() {
        if (lastDrawStep !== -1) {
            document.querySelectorAll(`.step[data-step='${lastDrawStep}']`).forEach(el => el.classList.remove('playing'));
        }

        // Use a different variable for drawing to avoid race conditions with scheduler
        const stepToDraw = (currentStep - 1 + NUM_STEPS) % NUM_STEPS;

        document.querySelectorAll(`.step[data-step='${stepToDraw}']`).forEach(el => el.classList.add('playing'));

        lastDrawStep = stepToDraw;

        // Keep UI update loop running
        if (isPlaying) {
            uiTimerID = setTimeout(updateUI, 1000 / 25); // ~25 FPS
        }
    }

    // --- Initialization ---
    function init() {
        for (let i = 0; i < NUM_PATTERNS; i++) {
            patterns[i] = new Array(NUM_STEPS).fill(0);
        }

        // Test Pattern: Kick, Snare, and Hats
        patterns[0][0] = 1; // Kick
        patterns[0][16] = 1;
        patterns[0][32] = 1;
        patterns[0][48] = 1;

        patterns[1][16] = 1; // Snare
        patterns[1][48] = 1;

        // Closed hats on 8th notes
        for (let i = 0; i < NUM_STEPS; i += 8) {
            patterns[2][i] = 1;
        }

        // Open hat
        patterns[3][56] = 1;

        // Clap
        patterns[4][32] = 1;

        // Toms
        patterns[5][58] = 1;
        patterns[5][60] = 1;
        patterns[5][62] = 1;

        // Synth Melody
        patterns[6][0] = 'C4';
        patterns[6][8] = 'E4';
        patterns[6][16] = 'G4';
        patterns[6][24] = 'C5';

        createPatternGrid();
        patternsContainer.addEventListener('click', handleStepClick);

        bpm = parseInt(bpmInput.value, 10);
        swing = parseInt(swingSlider.value, 10) / 100;
        swingSlider.addEventListener('input', (e) => { swingValueDisplay.textContent = `${e.target.value}%`; swing = parseInt(e.target.value, 10) / 100; });
        bpmInput.addEventListener('input', (e) => { bpm = parseInt(e.target.value, 10); });

        // Populate Chord Type dropdown
        const chordTypeDropdown = document.getElementById('synth-chord-type');
        for (const chordName in CHORD_MAP) {
            const option = document.createElement('option');
            option.value = chordName;
            option.textContent = chordName;
            chordTypeDropdown.appendChild(option);
        }

        playStopButton.addEventListener('click', togglePlayback);
        restartButton.addEventListener('click', restartSequence);

        // --- Synth Panel UI Logic ---
        function setupParameterControls() {
            // Kick Controls
            const kickControls = {
                decay: document.getElementById('kick-decay'),
                startPitch: document.getElementById('kick-start-pitch'),
                endPitch: document.getElementById('kick-end-pitch'),
                fmAmount: document.getElementById('kick-fm-amount')
            };
            kickControls.decay.addEventListener('input', e => synthParams.kick.decay = parseFloat(e.target.value));
            kickControls.startPitch.addEventListener('input', e => synthParams.kick.startPitch = parseInt(e.target.value, 10));
            kickControls.endPitch.addEventListener('input', e => synthParams.kick.endPitch = parseInt(e.target.value, 10));
            kickControls.fmAmount.addEventListener('input', e => synthParams.kick.fmAmount = parseInt(e.target.value, 10));

            // Snare Controls
            const snareControls = {
                toneDecay: document.getElementById('snare-tone-decay'),
                noiseDecay: document.getElementById('snare-noise-decay'),
                noiseFilter: document.getElementById('snare-noise-filter'),
                balance: document.getElementById('snare-balance')
            };
            snareControls.toneDecay.addEventListener('input', e => synthParams.snare.toneDecay = parseFloat(e.target.value));
            snareControls.noiseDecay.addEventListener('input', e => synthParams.snare.noiseDecay = parseFloat(e.target.value));
            snareControls.noiseFilter.addEventListener('input', e => synthParams.snare.noiseFilterFreq = parseInt(e.target.value, 10));
            snareControls.balance.addEventListener('input', e => synthParams.snare.balance = parseFloat(e.target.value));

            // Hat Controls
            const hatControls = {
                closedDecay: document.getElementById('hat-closed-decay'),
                openDecay: document.getElementById('hat-open-decay'),
                filterFreq: document.getElementById('hat-filter-freq')
            };
            hatControls.closedDecay.addEventListener('input', e => synthParams.hat.closedDecay = parseFloat(e.target.value));
            hatControls.openDecay.addEventListener('input', e => synthParams.hat.openDecay = parseFloat(e.target.value));
            hatControls.filterFreq.addEventListener('input', e => synthParams.hat.filterFreq = parseInt(e.target.value, 10));

            // Clap Controls
            const clapControls = {
                decay: document.getElementById('clap-decay'),
                spread: document.getElementById('clap-spread')
            };
            clapControls.decay.addEventListener('input', e => synthParams.clap.decay = parseFloat(e.target.value));
            clapControls.spread.addEventListener('input', e => synthParams.clap.spread = parseFloat(e.target.value));

            // Tom Controls
            const tomControls = {
                decay: document.getElementById('tom-decay'),
                startPitch: document.getElementById('tom-start-pitch'),
                endPitch: document.getElementById('tom-end-pitch')
            };
            tomControls.decay.addEventListener('input', e => synthParams.tom.decay = parseFloat(e.target.value));
            tomControls.startPitch.addEventListener('input', e => synthParams.tom.startPitch = parseInt(e.target.value, 10));
            tomControls.endPitch.addEventListener('input', e => synthParams.tom.endPitch = parseInt(e.target.value, 10));

            // Main Synth Controls
            document.getElementById('synth-decay').addEventListener('input', e => synthParams.mainSynth.decay = parseFloat(e.target.value));
            document.getElementById('synth-chord-mode').addEventListener('change', e => synthParams.mainSynth.chordMode = e.target.checked);
            document.getElementById('synth-chord-type').addEventListener('change', e => synthParams.mainSynth.chordType = e.target.value);
            document.getElementById('synth-inversion').addEventListener('input', e => synthParams.mainSynth.inversion = parseInt(e.target.value, 10));

            for (let i = 1; i <= 6; i++) {
                document.getElementById(`synth-osc${i}-pitch`).addEventListener('input', e => {
                    synthParams.mainSynth.oscillators[i - 1].pitch = parseInt(e.target.value, 10);
                });
            }
            document.getElementById('synth-osc2-fmdepth').addEventListener('input', e => synthParams.mainSynth.oscillators[1].fmDepth = parseInt(e.target.value, 10));
            document.getElementById('synth-osc3-rmdepth').addEventListener('input', e => synthParams.mainSynth.oscillators[2].rmDepth = parseFloat(e.target.value));
            document.getElementById('synth-osc5-fmdepth').addEventListener('input', e => synthParams.mainSynth.oscillators[4].fmDepth = parseInt(e.target.value, 10));
            document.getElementById('synth-osc6-rmdepth').addEventListener('input', e => synthParams.mainSynth.oscillators[5].rmDepth = parseFloat(e.target.value));


            // Master Controls
            const driveControl = document.getElementById('drive');
            driveControl.addEventListener('input', e => {
                if (saturator) {
                    saturator.curve = makeDistortionCurve(parseInt(e.target.value, 10));
                }
            });
        }
        setupParameterControls();

        const instrumentSelectors = document.querySelector('.instrument-selectors');
        instrumentSelectors.addEventListener('click', (e) => {
            if (!e.target.matches('.selector-btn')) return;

            const instrument = e.target.dataset.instrument;

            // Update button active states
            document.querySelectorAll('.selector-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            // Update panel visibility
            document.querySelectorAll('.settings-panel').forEach(panel => panel.classList.remove('active'));
            document.getElementById(`${instrument}-settings`).classList.add('active');
        });

        console.log('GUCCI DRUM Initialized.');
    }

    function setupAudioContext() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                noiseBuffer = createNoiseBuffer();

                // Set up master audio chain
                masterGain = audioContext.createGain();
                saturator = audioContext.createWaveShaper();
                saturator.curve = makeDistortionCurve(0); // Start with no distortion
                saturator.oversample = '4x';

                masterGain.connect(saturator);
                saturator.connect(audioContext.destination);

            } catch (e) {
                alert('Web Audio API is not supported in this browser.');
            }
        }
    }

    // --- Sequencer Logic ---
    function scheduler() {
        while (nextStepTime < audioContext.currentTime + 0.1) {
            if (patterns[0][currentStep] === 1) {
                createKick(nextStepTime);
            }
            if (patterns[1][currentStep] === 1) {
                createSnare(nextStepTime);
            }
            if (patterns[2][currentStep] === 1) {
                createHat(nextStepTime, 'closed');
            }
            if (patterns[3][currentStep] === 1) {
                createHat(nextStepTime, 'open');
            }
            if (patterns[4][currentStep] === 1) {
                createClap(nextStepTime);
            }
            if (patterns[5][currentStep] === 1) {
                createTom(nextStepTime);
            }
            if (patterns[6][currentStep]) {
                createSynthNote(patterns[6][currentStep], nextStepTime);
            }

            const secondsPerBeat = 60.0 / bpm;
            const sixteenthNoteDuration = secondsPerBeat / 4;

            if (currentStep % 2 !== 0) {
                nextStepTime += sixteenthNoteDuration * (1 + (swing - 0.5) * 2);
            } else {
                nextStepTime += sixteenthNoteDuration * (1 - (swing - 0.5) * 2);
            }

            currentStep = (currentStep + 1) % NUM_STEPS;
        }
        schedulerTimerID = setTimeout(scheduler, 25.0);
    }

    function togglePlayback() {
        setupAudioContext();
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        isPlaying = !isPlaying;
        if (isPlaying) {
            playStopButton.textContent = 'Stop';
            currentStep = 0;
            lastDrawStep = -1;
            nextStepTime = audioContext.currentTime;
            scheduler();
            updateUI(); // Start UI loop
        } else {
            playStopButton.textContent = 'Play';
            clearTimeout(schedulerTimerID);
            clearTimeout(uiTimerID);
            document.querySelectorAll('.step.playing').forEach(el => el.classList.remove('playing'));
        }
    }

    function restartSequence() {
        currentStep = 0;
        lastDrawStep = -1;
        if (isPlaying) {
           nextStepTime = audioContext.currentTime;
        }
    }

    init();
});
