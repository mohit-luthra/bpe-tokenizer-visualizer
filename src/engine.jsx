/* ============================================================
   Illustrative Byte-Pair Encoding engine.
   Deterministic, tuned to produce satisfying, human-readable
   subword merges (e.g. "tokenization" -> "token" + "ization").
   Exposes window.BPE = { plan, tokenId, tokenColor }.
   ============================================================ */
(function () {
  // ---- Curated vocabulary of words / morphemes / affixes -----
  // These are the "learned" subwords. A merge that COMPLETES one of
  // these scores highest; a merge that EXTENDS toward one scores next.
  const VOCAB_LIST = [
    // common short words
    "the","and","for","you","are","was","not","but","all","can","has","had",
    "her","him","his","one","our","out","day","get","use","new","now","old",
    "see","two","way","who","its","let","put","say","she","too","this","that",
    "with","have","from","they","will","your","what","when","make","like","time",
    "just","know","take","into","year","good","some","them","than","then","look",
    "only","come","over","also","back","after","work","first","well","even","want",
    "is","it","in","on","at","to","of","as","an","or","be","by","we","he","me",
    "so","no","go","up","if","do","my","am","us","es","est","get","her","him",
    // topical (tokenization-friendly)
    "token","tokens","encode","encoder","decode","decoder","model","models",
    "learn","learning","machine","language","text","word","words","byte","pair",
    "amaze","amazing","gpt","data","neural","network","vector","embed","embedding",
    "subword","char","character","vocab","corpus","prompt","train",
    // big-word roots
    "anti","dis","establish","ment","arian","ism","nation","national","function",
    "structure","construct","institution","constitution","government","develop",
    "development","environment","organization","international","understand",
    "together","get","her","under","stand",
    // prefixes
    "un","re","im","non","pre","pro","sub","super","trans","inter","over","mis",
    "de","en","em","co","com","con","ex","fore","mid","semi","auto","micro","macro",
    // suffixes
    "ing","ed","er","ers","est","ly","ion","tion","sion","ation","ization","ize",
    "ise","ment","ness","ful","less","able","ible","ous","ive","al","ic","ical",
    "ity","ty","ist","ism","ish","ward","wise","ship","hood","dom","ary","ory",
    "ent","ant","ence","ance","arian","ian","age","ure","ative",
  ];
  const VOCAB = new Set(VOCAB_LIST.map((w) => w.toLowerCase()));

  // All proper prefixes of vocab words -> lets greedy build up toward a word.
  const PREFIX = new Set();
  for (const w of VOCAB) {
    for (let i = 1; i < w.length; i++) PREFIX.add(w.slice(0, i));
  }

  // Fallback: very common English bigrams, used only for single+single
  // merges that aren't already building toward a vocab word.
  const BIGRAM = new Set(
    ("th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng " +
     "se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si " +
     "om ur ca el ta la ns di fo ho pe ec pr ad tr ee em ge ay ol")
      .split(" ")
  );

  function pairScore(a, b) {
    const ab = (a + b).toLowerCase();
    if (VOCAB.has(ab)) return 1000 + ab.length;      // completes a real subword
    if (PREFIX.has(ab)) return 500 + ab.length;       // building toward one
    if (a.length === 1 && b.length === 1 && BIGRAM.has(ab)) return 100; // generic
    return -Infinity;
  }

  // Split text into pre-tokens: letter runs, digit runs, single symbols.
  // Whitespace is dropped but marked so we can space groups apart visually.
  function pretokenize(text) {
    const groups = [];
    const re = /(\s+)|([A-Za-z]+)|([0-9]+)|([^\sA-Za-z0-9])/g;
    let m;
    let spaceBefore = false;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) { spaceBefore = true; continue; }
      const raw = m[2] || m[3] || m[4];
      groups.push({ raw, spaceBefore });
      spaceBefore = false;
    }
    return groups;
  }

  // Build the full animation plan: starting char cells + ordered merge steps.
  function plan(text) {
    const groups = pretokenize(text.slice(0, 40)); // safety cap
    let uid = 0;
    const initialCells = [];
    groups.forEach((g, gi) => {
      [...g.raw].forEach((ch, ci) => {
        initialCells.push({
          id: "c" + uid++,
          text: ch,
          group: gi,
          spaceBefore: ci === 0 && gi > 0 ? (g.spaceBefore ? 2 : 1) : 0,
        });
      });
    });

    // Simulate greedy merging to record ordered steps with stable ids.
    const work = initialCells.map((c) => ({ ...c }));
    const steps = [];
    let guard = 0;
    while (guard++ < 500) {
      let best = -Infinity;
      let bestI = -1;
      for (let i = 0; i < work.length - 1; i++) {
        if (work[i].group !== work[i + 1].group) continue;
        const s = pairScore(work[i].text, work[i + 1].text);
        if (s > best) { best = s; bestI = i; }
      }
      if (bestI === -1 || best === -Infinity) break;
      steps.push({ leftId: work[bestI].id, rightId: work[bestI + 1].id });
      work[bestI] = { ...work[bestI], text: work[bestI].text + work[bestI + 1].text };
      work.splice(bestI + 1, 1);
    }

    return { initialCells, steps, finalCells: work };
  }

  // Deterministic, GPT-2-range token id (0..50256). Repeated tokens share it.
  function tokenId(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (Math.abs(h) % 50000) + 256;
  }

  // Slightly desaturated, vivid palette so the mint-green chrome still frames.
  const PALETTE = [
    "#6F9BD8", "#E08B7B", "#C7A26B", "#84B59A", "#B58AC2", "#D89AB0",
    "#7FB0B5", "#C9C078", "#9A8FD0", "#8FBF7A", "#D2A06B", "#7AA8C2",
    "#C58FA0", "#9FB36B", "#B0A0D8", "#D9A98C",
  ];
  function tokenColor(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  window.BPE = { plan, tokenId, tokenColor };
})();
