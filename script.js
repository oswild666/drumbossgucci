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
        snare: {}, // placeholders for future steps
        hat: {},
        clap: {},
        tom: {}
    };

    // --- Sound Synthesis ---

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

        const masterGain = audioContext.createGain();
        masterGain.connect(audioContext.destination);

        // Noise component
        const noiseSource = audioContext.createBufferSource();
        noiseSource.buffer = noiseBuffer;

        const noiseFilter = audioContext.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 1500;

        const noiseGain = audioContext.createGain();
        noiseGain.gain.setValueAtTime(1, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);

        // Tonal component
        const bodyOsc = audioContext.createOscillator();
        bodyOsc.type = 'triangle';
        bodyOsc.frequency.setValueAtTime(200, time);
        bodyOsc.frequency.exponentialRampToValueAtTime(100, time + 0.1);

        const bodyGain = audioContext.createGain();
        bodyGain.gain.setValueAtTime(1, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

        bodyOsc.connect(bodyGain);
        bodyGain.connect(masterGain);

        // Start and stop
        noiseSource.start(time);
        noiseSource.stop(time + 0.2);
        bodyOsc.start(time);
        bodyOsc.stop(time + 0.2);
    }

    function createHat(time, type = 'closed') {
        if (!audioContext) return;

        const decayTime = type === 'closed' ? 0.05 : 0.4;

        const gain = audioContext.createGain();
        gain.connect(audioContext.destination);
        gain.gain.setValueAtTime(0.5, time); // Lower volume for hats
        gain.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

        const highpass = audioContext.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 7000;
        highpass.connect(gain);

        const noiseSource = audioContext.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.connect(highpass);

        noiseSource.start(time);
        noiseSource.stop(time + decayTime);
    }

    function createClap(time) {
        if (!audioContext) return;

        const masterGain = audioContext.createGain();
        masterGain.connect(audioContext.destination);
        masterGain.gain.value = 0.6; // Claps can be loud

        // The "tail" of the clap
        const tailGain = audioContext.createGain();
        tailGain.gain.setValueAtTime(1, time);
        tailGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

        const tailFilter = audioContext.createBiquadFilter();
        tailFilter.type = 'bandpass';
        tailFilter.frequency.value = 1200;
        tailFilter.Q.value = 5;
        tailFilter.connect(tailGain);
        tailGain.connect(masterGain);

        const tailSource = audioContext.createBufferSource();
        tailSource.buffer = noiseBuffer;
        tailSource.connect(tailFilter);
        tailSource.start(time);
        tailSource.stop(time + 0.2);

        // The short, sharp "slaps"
        const slapDelays = [0, 0.008, 0.015]; // in seconds
        slapDelays.forEach(delay => {
            const slapGain = audioContext.createGain();
            slapGain.gain.setValueAtTime(1, time + delay);
            slapGain.gain.exponentialRampToValueAtTime(0.01, time + delay + 0.02);

            const slapSource = audioContext.createBufferSource();
            slapSource.buffer = noiseBuffer;
            slapSource.connect(slapGain);
            slapGain.connect(masterGain);

            slapSource.start(time + delay);
            slapSource.stop(time + delay + 0.02);
        });
    }

    function createKick(time) {
        if (!audioContext) return;
        const params = synthParams.kick;
        const decayTime = params.decay;

        const ampEnvelope = audioContext.createGain();
        ampEnvelope.connect(audioContext.destination);
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
                if (patterns[p][s] === 1) {
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

        patterns[pattern][step] = patterns[pattern][step] === 1 ? 0 : 1;
        event.target.classList.toggle('active');
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

        createPatternGrid();
        patternsContainer.addEventListener('click', handleStepClick);

        bpm = parseInt(bpmInput.value, 10);
        swing = parseInt(swingSlider.value, 10) / 100;
        swingSlider.addEventListener('input', (e) => { swingValueDisplay.textContent = `${e.target.value}%`; swing = parseInt(e.target.value, 10) / 100; });
        bpmInput.addEventListener('input', (e) => { bpm = parseInt(e.target.value, 10); });
        playStopButton.addEventListener('click', togglePlayback);
        restartButton.addEventListener('click', restartSequence);

        // --- Synth Panel UI Logic ---
        function setupParameterControls() {
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
                noiseBuffer = createNoiseBuffer(); // Create noise buffer once context is ready
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
