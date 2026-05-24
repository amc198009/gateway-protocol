// Gateway Protocol — static content/data (extracted from app.js · V6·T8 step 2).
// Pure data (waves, frequencies, sessions, breath, affirmations, journal prompts,
// agents, protocols). No app-global dependencies. Loaded FIRST (before
// app-affect.js and app.js) so every consumer has the data at runtime.
// ═══════════════════════════ DATA ═══════════════════════════
const WAVES=[
  {id:1,name:"Wave I — Discovery",subtitle:"Resonant Tuning · Focus 10",color:"#7060d0",
    phases:[
      {name:"Resonant Tuning",freq:"Alpha 8–12 Hz",dur:"5 min",
       desc:"Hum at a comfortable pitch, feel the vibration move through your skull and chest. Monroe discovered the body has a natural resonant frequency (~7.8 Hz, matching the Schumann Resonance). This phase synchronizes your biofield with Earth's electromagnetic cavity."},
      {name:"Focus 10",freq:"Theta 4–8 Hz",dur:"15 min",
       desc:"Mind Awake / Body Asleep. The first true Gateway state. The body enters a state resembling sleep paralysis while consciousness remains completely alert. This paradoxical state is the prerequisite for all deeper work. You access it through progressive relaxation from feet upward while maintaining mental wakefulness."}
    ],code:"1111",intent:"Presence · Body Release · First Entry"},
  {id:2,name:"Wave II — Threshold",subtitle:"Energy Balloon · Focus 12",color:"#5050c0",
    phases:[
      {name:"Resonant Energy Balloon",freq:"Theta 4–8 Hz",dur:"10 min",
       desc:"Construct a torus-shaped energy field around your body using focused visualization. Monroe Institute researchers observed measurable changes in bioelectric readings during this exercise. The field serves as both protection and amplifier for subsequent states. Visualize it as golden or white light emanating from your heart center."},
      {name:"Focus 12",freq:"Deep Theta 4–6 Hz",dur:"20 min",
       desc:"Expanded Awareness. Awareness expands beyond the boundaries of physical form. Perception begins to include subtle energy fields, emotional atmospheres, and non-local information. Monroe described this as the 'first genuine expansion beyond consensus reality.' Thoughts become clearer, less verbal, more direct."}
    ],code:"55515",intent:"Expansion · Field Protection · Non-Local Perception"},
  {id:3,name:"Wave III — Freedom",subtitle:"Focus 15 · No-Time State",color:"#3060b0",
    phases:[
      {name:"Focus 15",freq:"Deep Theta 3–5 Hz",dur:"25 min",
       desc:"No Time. You enter a state outside of linear time. The subconscious mind — which operates atemporally, storing all memories simultaneously — becomes directly accessible. This is where Lipton's 'subconscious reprogramming' occurs most naturally. Early childhood programs, ancestral patterns, and core identity beliefs can be examined and rewritten here."},
      {name:"Focus 21",freq:"Delta/Theta border 2–4 Hz",dur:"30 min",
       desc:"Other Energy Systems. Awareness expands to encompass what Monroe called 'non-physical energy systems.' Creativity, breakthrough insight, and quantum downloads emerge at this level. Many who reach Focus 21 report contact with what Jung called the Collective Unconscious — the universal field of human knowledge and experience."}
    ],code:"888",intent:"Time Dissolution · Subconscious Access · Collective Field"},
  {id:4,name:"Wave IV — Adventure",subtitle:"H+ State · Belief Territories",color:"#207090",
    phases:[
      {name:"H+ State",freq:"Gamma + Delta blend 40Hz + 1Hz",dur:"30 min",
       desc:"Human Plus. Monroe's designation for the expanded human operating state. Simultaneous gamma (peak cognitive performance, 40 Hz) and delta (deep healing, 0–4 Hz) create the paradoxical state that characterizes OBEs and quantum healing. Dispenza's meditators show measurable gamma bursts during spontaneous healing events."},
      {name:"Focus 23–27",freq:"Variable",dur:"35 min",
       desc:"Belief System Territories. Monroe mapped specific non-physical 'locations' corresponding to dominant belief architectures. Focus 23 contains unintegrated trauma. Focus 25 holds religious/cultural programs. Focus 27 is what Monroe called the Reception Center — a state of pure creative potential. Jung would call these the activated archetypes of the collective unconscious."}
    ],code:"369",intent:"Identity Architecture · Belief Liberation · OBE Access"},
  {id:5,name:"Wave V — Healing",subtitle:"Cellular Reprogramming",color:"#208050",
    phases:[
      {name:"528 Hz Cellular Immersion",freq:"528 Hz + Theta 4–7 Hz",dur:"20 min",
       desc:"Lipton's research: 95% of all biological activity is controlled by the subconscious. In theta, you access the subconscious operating layer and can directly reprogram cellular behavior through visualization and intention. 528 Hz has been associated with DNA repair in several studies. Pair with a clear image of healed, vital cells flooding your body."},
      {name:"Future Body Memory",freq:"432 Hz + Delta 1–3 Hz",dur:"25 min",
       desc:"Dispenza's protocol: the body cannot distinguish between a vividly imagined experience and a real one. Create a complete sensory memory of yourself in a fully healed, pain-free, vital state — 6 months from now. Feel the emotion of it (gratitude, joy, relief) BEFORE physical evidence. The subconscious accepts emotionally charged future memories as present reality and reorganizes biology accordingly."}
    ],code:"528",intent:"Cellular Healing · Pain Dissolution · Regeneration"},
  {id:6,name:"Wave VI — Manifestation",subtitle:"Quantum Field Engineering",color:"#806010",
    phases:[
      {name:"Quantum Observer State",freq:"40 Hz Gamma",dur:"15 min",
       desc:"Tesla's principle: thought is an electromagnetic signal broadcast into the field. At 40 Hz gamma, you become the quantum observer — the point of consciousness that collapses probability waves into physical reality. This is not metaphor. Quantum mechanics demonstrates that observation affects physical outcomes. Your coherent intention at this frequency is a literal force."},
      {name:"Future Self Download",freq:"Theta 4–7 Hz",dur:"25 min",
       desc:"In the no-time state of deep theta, meet your 5-year future self who has already achieved the life you desire. This is not visualization — it is a memory of a future that exists in the field. Ask: 'What decision changed everything?' The answer that arrives is not imagined — it is accessed from the quantum field of possibilities that Tesla called the Ether."}
    ],code:"888",intent:"Reality Engineering · Wealth Programming · Future Self"},
  {id:7,name:"Wave VII — Integration",subtitle:"Shadow Work · Anchoring",color:"#806030",
    phases:[
      {name:"Shadow Integration",freq:"Alpha 8–10 Hz",dur:"15 min",
       desc:"Jung: 'Until you make the unconscious conscious, it will direct your life and you will call it fate.' The wealth, health, love, or freedom you most strongly reject, judge, or envy in others points to the disowned part of yourself that blocks you. In this phase: identify your strongest judgment of another person. Recognize it as a disowned aspect of your own potential. Integrate it."},
      {name:"Somatic Anchoring",freq:"Beta return 12–15 Hz",dur:"10 min",
       desc:"Create a physical anchor at the peak state: gently touch your thumb and index finger together while holding maximum coherence (gratitude + expanded awareness + physical sensation of the desired state). Repeat 3x. This encodes the neurological state into a retrievable somatic cue. In waking life, touching this anchor re-activates the coherent state in 3–5 seconds."}
    ],code:"1111",intent:"Shadow Integration · Embodiment · Somatic Anchoring"}
];

const SOLFEGGIO=[
  {hz:174,name:"Foundation",effect:"Pain relief, security, grounding. Reduces physical and emotional pain at the cellular level. The body's deepest safety signal.",col:"#c04040"},
  {hz:285,name:"Quantum Field",effect:"Influences energy fields directly. Repairs and rejuvenates tissues. Leaves the body feeling restructured and energized.",col:"#c06030"},
  {hz:396,name:"Liberation",effect:"Liberates guilt and fear — the two primary blocks to abundance and healing. Converts grief into joy. Root chakra reset.",col:"#c08020"},
  {hz:417,name:"Transmutation",effect:"Facilitates change. Clears traumatic experiences from cellular memory. Enables situations to undo and rewrite themselves.",col:"#80a030"},
  {hz:432,name:"Natural Resonance",effect:"Universal harmonic aligned with nature's oscillation. Calms the nervous system. Synchronizes brain hemispheres organically.",col:"#40a040"},
  {hz:528,name:"DNA Repair",effect:"Love frequency. Associated with DNA repair. The center of the Solfeggio scale. Produces emotional transformation and miracles.",col:"#3090a0"},
  {hz:639,name:"Connection",effect:"Harmonizes relationships, enhances communication, tolerance, and love. Heals broken connections between people and between self-aspects.",col:"#3060c0"},
  {hz:741,name:"Awakening",effect:"Cleanses cells of toxins and electromagnetic radiation. Awakens intuition. Enhances problem-solving and self-expression.",col:"#5040b0"},
  {hz:852,name:"Spiritual Order",effect:"Returns consciousness to spiritual order. Awakens the third eye. Activates intuition. Dissolves illusions of separation.",col:"#7030a0"},
  {hz:963,name:"Divine Connection",effect:"Activates the pineal gland. Creates unity with the universal field. Monroe's Focus 27 state. Crown activation.",col:"#a020a0"}
];

const SESSIONS=[
  {name:"Morning Activation",dur:10,icon:"☀",phases:["Resonant Tuning","Focus 3 entry","Code imprinting"]},
  {name:"Focus 10 Entry",dur:20,icon:"◎",phases:["Resonant Tuning","Body release","Focus 10 hold"]},
  {name:"Deep Coherence",dur:30,icon:"∞",phases:["Breathwork","Focus 12","Expanded awareness"]},
  {name:"Gateway Immersion",dur:60,icon:"◈",phases:["Tuning","Focus 10","Focus 12","Focus 15"]},
  {name:"Pain Dissolution",dur:25,icon:"✦",phases:["174 Hz breath","Cellular dialogue","528 Hz flood","Future body"]},
  {name:"Wealth State",dur:35,icon:"◉",phases:["Shadow scan","369 encoding","888 loop","Future self meeting"]},
  {name:"Sleep Programming",dur:40,icon:"☽",phases:["4-7-8 breath","Focus 10","Affirmation loop","Theta drift"]},
  {name:"Full Integration",dur:90,icon:"⊕",phases:["Wave I","Wave II","Wave III","Wave VII"]}
];

const BREATH_PATTERNS=[
  {name:"Coherence 5-5",i:5,h:0,e:5,science:"Heart-brain coherence. HRV synchronization. Activates vagal tone.",target:"Alpha–Theta bridge"},
  {name:"Gateway 5-5-5",i:5,h:5,e:5,science:"Monroe's preparation pattern. The hold phase amplifies bioelectric field charge.",target:"Focus 10 entry"},
  {name:"Box 4-4-4-4",i:4,h:4,e:4,hold2:4,science:"Military protocol. Balances sympathetic/parasympathetic. Rapid cortisol reduction.",target:"Nervous system reset"},
  {name:"Dispenza 4-0-8",i:4,h:0,e:8,science:"Extended exhale doubles vagal activation. Used before Dispenza's quantum field work.",target:"Deep theta access"},
  {name:"Tesla 3-6-9",i:3,h:6,e:9,science:"Tesla's numerological encoding. Ratio creates phi-harmonic breathing cycle.",target:"369 code activation"},
  {name:"Pranayama 4-7-8",i:4,h:7,e:8,science:"Dr. Weil's protocol. 4-7-8 ratio produces powerful parasympathetic dominance in under 60 seconds.",target:"Rapid relaxation"}
];

const AFFIRMATIONS=[
  {code:"55515",text:"I am being upgraded. Every change accelerating in my reality is in my favor. My life is expanding into its highest and most luminous form right now.",intent:"Wealth · Freedom · Life Upgrade"},
  {code:"528 Hz",text:"Every cell in my body is healing, harmonizing, and returning to its original blueprint of perfection. I vibrate at the frequency of love and wholeness.",intent:"Healing · DNA Repair · Vitality"},
  {code:"888",text:"I am a clear and open channel for infinite abundance. Wealth flows to me through pathways I have not yet imagined, from directions I cannot predict.",intent:"Abundance · Receiving · Flow"},
  {code:"369",text:"I create my reality with focused intention. My desires already exist in the quantum field. I simply allow them to materialize into physical form.",intent:"Manifestation · Certainty · Creation"},
  {code:"1111",text:"I choose the thoughts of my most expanded self. I am fully aligned with the version of me who already lives in freedom, health, and abundance.",intent:"Alignment · Presence · Quantum Self"},
  {code:"432 Hz",text:"I am in resonance with the living universe. My nervous system is calm, my mind is clear, and every cell in my body trusts the intelligence that created it.",intent:"Peace · Groundedness · Natural Order"},
  {code:"Focus 15",text:"I exist beyond the limits of time. The past does not define me. The future I choose is as real as this moment. I am the author of my experience.",intent:"Liberation · Time Freedom · Authorship"},
  {code:"Shadow",text:"Every quality I see and judge in others is a reflection of my own unintegrated potential. I reclaim all of myself. I am complete. I am whole.",intent:"Shadow Integration · Wholeness · Jung"},
  {code:"Gateway",text:"My consciousness is vast, unlimited, and free. I expand beyond every conditioned thought. I access states of knowing that exist beyond ordinary awareness.",intent:"Consciousness · OBE · Monroe"}
];

const JOURNAL_PROMPTS=[
  {label:"Dominant State Today",ph:"What frequency are you operating from right now?"},
  {label:"What Shifted",ph:"What changed, lifted, or became clearer in today's session?"},
  {label:"Downloads & Insights",ph:"What arrived during stillness? Record it without judgment."},
  {label:"Resistance Encountered",ph:"What came up — fear, doubt, contraction? Name it precisely."},
  {label:"Shadow Observation",ph:"What triggered you today? What disowned quality does it point to?"},
  {label:"Intention for Next Session",ph:"What do you want to access, release, or anchor next time?"}
];

const AGENTS=[
  {symbol:"◎",name:"Robert Monroe",domain:"Consciousness Explorer · OBE Pioneer · Hemi-Sync Creator"},
  {symbol:"⊗",name:"Dr. Bruce Lipton",domain:"Cell Biologist · Epigenetics · Biology of Belief"},
  {symbol:"⊕",name:"Dr. Joe Dispenza",domain:"Neuroscientist · Quantum Healing · Brain Rewiring"},
  {symbol:"⚡",name:"Nikola Tesla",domain:"Electromagnetic Theory · 3-6-9 · Resonance Engineer"},
  {symbol:"⊖",name:"Carl Gustav Jung",domain:"Depth Psychology · Shadow Work · Collective Unconscious"}
];

const INSIGHTS=[
  {agent:"Robert Monroe",text:"The Gateway is not a destination. It is a doorway. Every human being already possesses the capability — the techniques simply remove the noise that obscures what is already there."},
  {agent:"Dr. Bruce Lipton",text:"Your subconscious mind is running 95% of your life from programs you downloaded before the age of seven. The Gateway state is one of the only natural portals to rewrite those programs while conscious."},
  {agent:"Dr. Joe Dispenza",text:"The quantum field doesn't respond to what you want. It responds to who you are being. When you can feel the emotion of your desired life before the evidence arrives — that is when the field reorganizes around you."},
  {agent:"Nikola Tesla",text:"If you want to find the secrets of the universe, think in terms of energy, frequency, and vibration. Everything you call solid reality is simply standing wave patterns in the electromagnetic field. You are a transmitter."},
  {agent:"Carl Gustav Jung",text:"Until you make the unconscious conscious, it will direct your life and you will call it fate. The wealth, freedom, and love you most strongly deny in yourself are the precise coordinates of your next evolution."}
];

const PAIN_PROTOCOL={
  title:"Pain Dissolution Protocol",
  subtitle:"Monroe · Lipton · Dispenza Synthesis",
  steps:[
    {num:1,name:"Locate & Witness",time:"3 min",desc:"In Focus 10, locate the pain. Give it a geometric shape, a color, and a texture. Do not fight it. Observe it with scientific curiosity, as if you are a researcher studying a fascinating phenomenon. The act of observation without resistance begins to change it."},
    {num:2,name:"174 Hz Breath",time:"5 min",desc:"174 Hz is the Solfeggio frequency most associated with pain relief. Breathe slowly (5 sec in, 5 sec out). On each exhale, visualize the pain's color becoming lighter. From red → orange → yellow → white. Note what changes."},
    {num:3,name:"Dialogue",time:"5 min",desc:"Ask the pain: 'What are you protecting me from? What do you want me to know?' Pain is often compressed emotion, stored trauma, or a communication from the body. Listen without judgment. The answer that arises may be surprising."},
    {num:4,name:"528 Hz Flood",time:"8 min",desc:"Visualize golden-green 528 Hz light entering through the crown of your head. Watch it flow down to the site of pain. See it at the cellular level — DNA strands repairing, inflammation dissolving, healthy cells multiplying. The body cannot distinguish vivid visualization from physical experience."},
    {num:5,name:"Future Body Memory",time:"5 min",desc:"Project yourself 6 months forward into a body that is fully healed and vital. Create a complete sensory memory — what you see, feel, hear, the ease of movement. Generate genuine gratitude for this healed state as if it is already done. Hold that emotional signal for at least 90 seconds. This is Dispenza's protocol for cellular reprogramming."}
  ]
};

const WEALTH_PROTOCOL={
  title:"Wealth State Programming",
  subtitle:"Tesla · Monroe · Dispenza · Jung Synthesis",
  steps:[
    {num:1,name:"Shadow Scan",time:"5 min",desc:"In Focus 15, identify your three strongest judgments about wealthy people or money. These judgments are the exact programs blocking your abundance. Write them down after the session. Then ask: 'If this quality I'm judging were actually a strength — what would it look like?' This is Jung's shadow integration applied to wealth."},
    {num:2,name:"Frequency Clear",time:"5 min",desc:"In theta state, visualize all inherited poverty programs leaving your body as gray smoke on each exhale. These are the beliefs you absorbed before age 7: 'money doesn't grow on trees,' 'rich people are greedy,' 'we can't afford that.' Watch them dissolve. You are not your programming."},
    {num:3,name:"369 Code Encoding",time:"7 min",desc:"While in alpha/theta, internally speak your specific wealth statement 3 times with full emotional presence. Make it specific, present tense, emotionally charged. 'I am generating [$X] per month doing work I love with complete ease and joy.' Feel the reality of it as you say it. Later: write it 3x morning, 6x midday, 9x night for 33 days."},
    {num:4,name:"55515 Activation",time:"7 min",desc:"Visualize the code 55515 in luminous gold before your inner eye. Each 5 = an accelerating change in your financial reality. The central 1 = the new timeline anchoring now. Feel a wave of energy moving through your body as you hold this. Tesla: 'You are a receiver as much as a transmitter — tune yourself to the frequency of what you desire.'"},
    {num:5,name:"Future Self Download",time:"10 min",desc:"In Focus 21, meet the version of you 5 years from now who is fully financially free. They are walking, talking, and living in the reality you desire. Ask them: 'What single decision changed everything?' 'What did you stop believing?' 'What did you start doing?' Listen without filtering. The answers come from the quantum field of your own highest potential."}
  ]
};
