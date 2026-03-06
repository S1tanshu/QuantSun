import { useState, useEffect, useRef, useCallback, useMemo } from "react"

// ─────────────────────────────────────────────
//  EMBEDDED DATA  (from Excel + docx + research)
// ─────────────────────────────────────────────

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/courses.js  (when splitting into separate files)
// SOURCE: Course_records.xlsx → "Source" sheet, 120 rows, auto-parsed Feb 2026
// SCHEMA: { id, subject, institution, code, name, source, link, lectures, priority, status }
// HOW TO ADD: append a new object following the same structure
// HOW TO EDIT: find by id or name and update fields
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VERSION — bump this once per release
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const APP_VERSION = "v1.26"

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI PROVIDER ADAPTER — swap provider without touching any feature code
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const AI_PROVIDERS = {
  groq: {
    label: "Groq",
    badge: "FREE",
    badgeColor: "#10b981",
    model: "llama-3.3-70b-versatile",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_...",
    hint: "Free tier: 14,400 req/day. Best for broke students 🙌",
  },
  gemini: {
    label: "Gemini",
    badge: "FREE",
    badgeColor: "#10b981",
    model: "gemini-1.5-flash",
    url: null, // handled separately
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyPlaceholder: "AIza...",
    hint: "Free tier: 1,500 req/day. Google's fast model.",
  },
  mistral: {
    label: "Mistral",
    badge: "FREE TIER",
    badgeColor: "#6366f1",
    model: "mistral-small-latest",
    url: "https://api.mistral.ai/v1/chat/completions",
    keyUrl: "https://console.mistral.ai/api-keys",
    keyPlaceholder: "...",
    hint: "Free tier available. European AI, privacy friendly.",
  },
  anthropic: {
    label: "Anthropic",
    badge: "PAID",
    badgeColor: "#C17F3A",
    model: "claude-sonnet-4-20250514",
    url: "https://api.anthropic.com/v1/messages",
    keyUrl: "https://console.anthropic.com/keys",
    keyPlaceholder: "sk-ant-...",
    hint: "~$0.01–0.03 per call. Best quality.",
  },
}

// Universal AI call — works with any provider
const callAI = async ({ system = "", prompt, maxTokens = 800, aiSettings = {} }) => {
  const { provider = "groq", key = "" } = aiSettings
  if (!key.trim()) throw new Error("NO_KEY")
  const p = AI_PROVIDERS[provider]

  // ── Anthropic ──────────────────────────────────────────────────────────────
  if (provider === "anthropic") {
    const body = { model: p.model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }
    if (system) body.system = system
    const res = await fetch(p.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    })
    const d = await res.json()
    if (d.error) throw new Error(d.error.message)
    return d.content?.find(b => b.type === "text")?.text || ""
  }

  // ── Gemini ─────────────────────────────────────────────────────────────────
  if (provider === "gemini") {
    const parts = system
      ? [{ text: system + "\n\n" + prompt }]
      : [{ text: prompt }]
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens } }) }
    )
    const d = await res.json()
    if (d.error) throw new Error(d.error.message)
    return d.candidates?.[0]?.content?.parts?.[0]?.text || ""
  }

  // ── Groq / Mistral (OpenAI-compatible) ────────────────────────────────────
  const msgs = []
  if (system) msgs.push({ role: "system", content: system })
  msgs.push({ role: "user", content: prompt })
  const res = await fetch(p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ model: p.model, max_tokens: maxTokens, messages: msgs }),
  })
  const d = await res.json()
  if (d.error) throw new Error(d.error?.message || "API error")
  return d.choices?.[0]?.message?.content || ""
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GITHUB DATA LOADER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HOW TO USE WHEN DEPLOYING:
//   1. Create a public GitHub repo (e.g. "quantos-data")
//   2. Add JSON files: courses.json, competitions.json, internships.json, jobs.json
//   3. Each file is just the array exported as JSON — same fields as hardcoded data below
//   4. Paste the raw GitHub URL for each file in the GITHUB_DATA_URLS object below
//   5. In each component that uses the data, swap the hardcoded const for the
//      loaded version: e.g. replace COURSES with (githubData.courses || COURSES)
//   6. Once confirmed working, delete the hardcoded arrays to keep the file clean
//
// RAW URL FORMAT:
//   https://raw.githubusercontent.com/YOUR_USERNAME/quantos-data/main/courses.json
//
// NOTE: The repo must be PUBLIC. No API key needed. GitHub CDN is free & fast.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── STEP 1: Raw GitHub URLs ───────────────────────────────────────────────────
const GITHUB_DATA_URLS = {
  courses:      "https://raw.githubusercontent.com/S1tanshu/quantos-data/main/courses.json",
  competitions: "https://raw.githubusercontent.com/S1tanshu/quantos-data/main/competitions.json",
  internships:  "https://raw.githubusercontent.com/S1tanshu/quantos-data/main/internships.json",
  jobs:         "https://raw.githubusercontent.com/S1tanshu/quantos-data/main/jobs.json",
  schedules:    "https://raw.githubusercontent.com/S1tanshu/quantos-data/main/schedules.json",
}


// ── STEP 2: Hook fetches all 4 files on app load ─────────────────────────────
const useGithubData = () => {
  const [githubData, setGithubData] = useState({})
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  useEffect(() => {
    const fetchAll = async () => {
      try {
          const bust = `?t=${Date.now()}`
        const settled = await Promise.allSettled(
          Object.entries(GITHUB_DATA_URLS).map(async ([key, url]) => {
            const res = await fetch(url + bust, { cache: "no-cache" })
            if (!res.ok) throw new Error(`${key}: ${res.status}`)
            const data = await res.json()
            return [key, data]
          })
        )
        const loaded = {}
        const failed = []
        settled.forEach((r, i) => {
          const key = Object.keys(GITHUB_DATA_URLS)[i]
          if (r.status === "fulfilled") loaded[key] = r.value[1]
          else failed.push(`${key}(${r.reason?.message})`)
        })
        if (failed.length) console.warn("QuantOS data fetch failed:", failed.join(", "))
        setGithubData(loaded)
      } catch (e) {
        console.warn("GitHub data fetch failed — falling back to hardcoded data.", e.message)
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  const loadedKeys = Object.keys(githubData)
  return { githubData, loading, error, isLive: loadedKeys.length > 0, loadedKeys }
}

// ── STEP 3-6 now implemented below in QuantOS() shell ───────────────────────

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HARDCODED DATA (delete these arrays once GitHub fetch is working)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const COURSES = [
  // ═══ COMPUTER SCIENCE ═══
  { id:"c0",  subject:"Comp Sci",          institution:"MIT",            code:"MIT 6.042J",    name:"Mathematics for Computer Science",                               source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.042J+Mathematics+for+Computer+Science,+Fall+2010",                lectures:"25/25", priority:"A", status:0 },
  { id:"c1",  subject:"Comp Sci",          institution:"MIT",            code:"MIT 6.041",     name:"Probability Systems Analysis and Applied Probability",           source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.041SC+Probabilistic+Systems+Analysis+and+Applied+Probability,+Fall+2013", lectures:"0/25",  priority:"A", status:0 },
  { id:"c2",  subject:"Comp Sci",          institution:"MIT",            code:"MIT 6.0002",    name:"Introduction to Computational Thinking and Data Science",         source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=Introduction+to+computational+thinking+and+data+sci",                                       lectures:"0/?",   priority:"A", status:0 },
  { id:"c3",  subject:"Comp Sci",          institution:"IIT",            code:"MCS202",        name:"Computer Organisation",                                          source:"NPTEL",    link:"https://www.youtube.com/results?search_query=Computer+Sc+-+Computer+Organization",                                           lectures:"4/33",  priority:"A", status:0 },
  { id:"c4",  subject:"Comp Sci",          institution:"Carnegie Mellon",code:"447/MCS202",    name:"Computer Architecture",                                          source:"Others",   link:"https://www.youtube.com/playlist?list=PL5PHm2jkkXmi5CxxI7b3JCL1TWybTDtKq",                                                  lectures:"1/39",  priority:"A", status:0 },
  { id:"c5",  subject:"Comp Sci",          institution:"MIT",            code:"MIT 18.086",    name:"Mathematical Methods for Engineers",                             source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+18.086+Mathematical+methods+for+engineers",                                              lectures:"0/?",   priority:"B", status:0 },
  { id:"c6",  subject:"Comp Sci",          institution:"MIT",            code:"MIT 18.S191",   name:"Introduction to Computational Thinking",                         source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=Introduction+to+computational+thinking",                                                      lectures:"0/?",   priority:"B", status:0 },
  { id:"c7",  subject:"Comp Sci",          institution:"Stanford",       code:"CS 109",        name:"Introduction to Probability for Computer Scientists",            source:"Youtube",  link:"https://www.youtube.com/results?search_query=Stanford+CS109+Introduction+to+Probability+for+Computer+Scientists+2022+Chris+Piech", lectures:"0/29",  priority:"A", status:0 },
  { id:"c8",  subject:"Comp Sci",          institution:"Stanford",       code:"CS 110",        name:"Principles of Computer Systems",                                 source:"Youtube",  link:"https://www.youtube.com/results?search_query=Stanford+CS110+Principles+of+Computer+Systems",                               lectures:"0/?",   priority:"B", status:0 },
  { id:"c9",  subject:"Comp Sci",          institution:"Stanford",       code:"CS 149",        name:"Parallel Computing",                                             source:"Youtube",  link:"https://www.youtube.com/results?search_query=Stanford+CS149+Parallel+Computing+2023",                                        lectures:"0/19",  priority:"B", status:0 },
  { id:"c10", subject:"Comp Sci",          institution:"Stanford",       code:"CS 224",        name:"Advanced Algorithms",                                            source:"Youtube",  link:"https://www.youtube.com/results?search_query=Advanced+Algorithms+COMPSCI+224",                                              lectures:"0/25",  priority:"A", status:0 },
  { id:"c11", subject:"Comp Sci",          institution:"Stanford",       code:"CS 154",        name:"Introduction to Theory of Computation",                          source:"Youtube",  link:"https://www.youtube.com/results?search_query=CS154+Stanford+Introduction+to+the+Theory+of+Computing",                     lectures:"0/41",  priority:"B", status:0 },
  { id:"c12", subject:"Comp Sci",          institution:"Stanford",       code:"CS 162",        name:"Operating Systems and Systems Programming",                       source:"Youtube",  link:"https://www.youtube.com/results?search_query=CS+162+Operating+Systems+and+Systems+Programming+Berkeley",                  lectures:"0/27",  priority:"B", status:0 },
  { id:"c13", subject:"Comp Sci",          institution:"Stanford",       code:"CS 364A",       name:"Algorithmic Game Theory",                                        source:"Youtube",  link:"https://www.youtube.com/results?search_query=Algorithmic+Game+Theory+Stanford+CS364A+Fall+2013",                          lectures:"6/20",  priority:"A", status:0 },
  { id:"c14", subject:"Comp Sci",          institution:"MIT",            code:"MIT 16.842",    name:"Fundamentals of Systems Engineering",                            source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+16.842+Fundamentals+of+Systems+Engineering+Fall+2015",                  lectures:"0/12",  priority:"C", status:0 },
  { id:"c15", subject:"Comp Sci",          institution:"MIT",            code:"MIT 6.172",     name:"Performance Engineering of Software Systems",                    source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.172+Performance+Engineering+of+Software+Systems+Fall+2018",           lectures:"0/23",  priority:"A", status:0 },
  { id:"c16", subject:"Comp Sci",          institution:"MIT",            code:"MIT 6.824",     name:"Distributed Systems",                                            source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.824+Distributed+Systems+Spring+2020",                                   lectures:"0/20",  priority:"A", status:0 },
  { id:"c17", subject:"Comp Sci",          institution:"Others",         code:"Oxford",        name:"Information Theory (Oxford)",                                    source:"Youtube",  link:"https://www.youtube.com/results?search_query=Student+Lectures+Information+Theory+Oxford",                                   lectures:"0/8",   priority:"B", status:0 },
  { id:"c18", subject:"Comp Sci",          institution:"Others",         code:"Harvard",       name:"Information Theory (Harvard 2022)",                              source:"Youtube",  link:"https://www.youtube.com/results?search_query=Information+Theory+Harvard+2022+full+course",                                 lectures:"0/19",  priority:"B", status:0 },
  { id:"c19", subject:"Comp Sci",          institution:"Others",         code:"NPTEL",         name:"Randomised Algorithms",                                          source:"Youtube",  link:"https://www.youtube.com/results?search_query=Randomized+Algorithms+NPTEL",                                                   lectures:"0/41",  priority:"B", status:0 },
  { id:"c20", subject:"Comp Sci",          institution:"NPTEL",          code:"NPTEL",         name:"Optimization",                                                   source:"Youtube",  link:"https://www.youtube.com/results?search_query=NOC+NPTEL+Optimization",                                                        lectures:"0/60",  priority:"A", status:0 },
  { id:"c21", subject:"Comp Sci",          institution:"Others",         code:"Meta",          name:"Database Engineering Complete Course",                            source:"Youtube",  link:"https://www.youtube.com/results?search_query=Database+Engineering+Complete+Course+DBMS",                                   lectures:"0/?",   priority:"B", status:0 },
  { id:"c22", subject:"Comp Sci",          institution:"FreeCodeCamp",   code:"cs4320",        name:"Database Management Systems (Cornell / FCC)",                    source:"Youtube",  link:"https://www.youtube.com/results?search_query=Database+Systems+Cornell+University+Course+SQL+NoSQL+Large-Scale+Data+Analysis", lectures:"0/17",  priority:"B", status:0 },
  { id:"c23", subject:"Comp Sci",          institution:"MIT",            code:"MIT 6.441",     name:"Information Theory",                                             source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+6.441+information+theory",                                                                lectures:"0/23",  priority:"B", status:0 },

  // ═══ MACHINE LEARNING ═══
  { id:"ml0", subject:"Machine Learning",  institution:"MIT",            code:"MIT 6.034",     name:"Artificial Intelligence",                                        source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.034+Artificial+Intelligence+Fall+2010",                                 lectures:"0/30",  priority:"A", status:0 },
  { id:"ml1", subject:"Machine Learning",  institution:"MIT",            code:"MIT 6.S191",    name:"Introduction to Deep Learning",                                  source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.S191+Introduction+to+Deep+Learning",                                   lectures:"0/80",  priority:"A", status:0 },
  { id:"ml2", subject:"Machine Learning",  institution:"MIT",            code:"MIT 6.s866",    name:"Machine Learning for Healthcare",                                source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.S897+Machine+Learning+for+Healthcare+Spring+2019",                    lectures:"0/25",  priority:"B", status:0 },
  { id:"ml3", subject:"Machine Learning",  institution:"MIT",            code:"MIT 6.867",     name:"Machine Learning (MIT)",                                         source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+6.867+machine+learning",                                                                  lectures:"0/24",  priority:"A", status:0 },
  { id:"ml4", subject:"Machine Learning",  institution:"Stanford",       code:"CS 221",        name:"Artificial Intelligence: Principles and Techniques",              source:"Youtube",  link:"https://www.youtube.com/results?search_query=Stanford+CS221+Artificial+Intelligence+Principles+and+Techniques+Autumn+2019", lectures:"0/19",  priority:"A", status:0 },
  { id:"ml5", subject:"Machine Learning",  institution:"Stanford",       code:"CS 229",        name:"Machine Learning (Andrew Ng 2018)",                              source:"Youtube",  link:"https://www.youtube.com/results?search_query=Stanford+CS229+Machine+Learning+Full+Course+Andrew+Ng+Autumn+2018",           lectures:"0/20",  priority:"A", status:0 },
  { id:"ml6", subject:"Machine Learning",  institution:"Stanford",       code:"CS 234",        name:"Reinforcement Learning",                                         source:"Youtube",  link:"https://www.youtube.com/results?search_query=Stanford+CS234+Reinforcement+Learning+Spring+2024+Emma+Brunskill",            lectures:"0/16",  priority:"A", status:0 },
  { id:"ml7", subject:"Machine Learning",  institution:"Coursera",       code:"Coursera",      name:"Machine Learning and Reinforcement Learning in Finance",          source:"Coursera", link:"https://www.coursera.org/search?query=machine+learning+reinforcement+learning+finance",                                     lectures:"0/?",   priority:"A", status:0 },
  { id:"ml8", subject:"Machine Learning",  institution:"MIT",            code:"MIT 9.13",      name:"The Human Brain",                                                source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+9.13+The+Human+Brain+Spring+2019",                                        lectures:"0/17",  priority:"C", status:0 },
  { id:"ml9", subject:"Machine Learning",  institution:"MIT",            code:"MIT 9.40",      name:"Introduction to Neural Computation",                             source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+9.40+Introduction+to+Neural+Computation+Spring+2018",                    lectures:"0/20",  priority:"B", status:0 },
  { id:"ml10",subject:"Machine Learning",  institution:"MIT",            code:"MIT",           name:"Liquid Neural Networks (LNN)",                                   source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=Drones+navigate+unseen+environments+with+liquid+neural+networks",            lectures:"0/?",   priority:"C", status:0 },
  { id:"ml11",subject:"Machine Learning",  institution:"Stanford",       code:"CS 224N",       name:"NLP with Deep Learning",                                         source:"Youtube",  link:"https://www.youtube.com/results?search_query=Stanford+CS224N+Natural+Language+Processing+with+Deep+Learning+2023",         lectures:"0/23",  priority:"B", status:0 },
  { id:"ml12",subject:"Machine Learning",  institution:"Stanford",       code:"CS 231n",       name:"Convolutional Neural Networks for Visual Recognition",            source:"Youtube",  link:"https://www.youtube.com/results?search_query=Lecture+Collection+Convolutional+Neural+Networks+for+Visual+Recognition+Spring+2017", lectures:"0/16", priority:"B", status:0 },

  // ═══ PROGRAMMING ═══
  { id:"p0",  subject:"Programming",       institution:"MIT",            code:"MIT 6.100L",    name:"Introduction to CS and Programming with Python",                 source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.100L+Introduction+to+CS+and+Programming+using+Python+Fall+2022",    lectures:"1/23",  priority:"A", status:0 },
  { id:"p1",  subject:"Programming",       institution:"MIT",            code:"MIT 6.046J",    name:"Design and Analysis of Algorithms",                              source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.046J+Design+and+Analysis+of+Algorithms+Spring+2015",                lectures:"0/34",  priority:"A", status:0 },
  { id:"p2",  subject:"Programming",       institution:"MIT",            code:"MIT 6.006",     name:"Introduction to Algorithms",                                     source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.006+Introduction+to+Algorithms+Spring+2020",                          lectures:"10/32", priority:"A", status:0 },
  { id:"p3",  subject:"Programming",       institution:"MIT",            code:"MIT 6.033",     name:"Computer Systems Engineering",                                   source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.033+Computer+System+Engineering+Spring+2005",                        lectures:"0/22",  priority:"B", status:0 },
  { id:"p4",  subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"C and Objective-C",                                              source:"Youtube",  link:"https://www.youtube.com/results?search_query=FreeCodeCamp+C+Objective+C",                                                  lectures:"0/3",   priority:"B", status:0 },
  { id:"p5",  subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"C++ Programming – Beginner to Advanced",                         source:"Youtube",  link:"https://www.youtube.com/results?search_query=C+++Programming+Course+Beginner+to+Advanced+FreeCodeCamp",                  lectures:"0/3",   priority:"A", status:0 },
  { id:"p6",  subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"Python for Beginners – Full Course",                             source:"Youtube",  link:"https://www.youtube.com/results?search_query=Python+for+Beginners+Full+Course+Programming+Tutorial+FreeCodeCamp",     lectures:"0/?",   priority:"A", status:0 },
  { id:"p7",  subject:"Programming",       institution:"Olivestem",      code:"x86/NASM",      name:"x86 Assembly with NASM",                                         source:"Youtube",  link:"https://www.youtube.com/results?search_query=x86+Assembly+with+NASM",                                                       lectures:"0/?",   priority:"B", status:0 },
  { id:"p8",  subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"Java – Full Tutorial for Beginners",                             source:"Youtube",  link:"https://www.youtube.com/results?search_query=Learn+Java+8+Full+Tutorial+for+Beginners",                                   lectures:"0/?",   priority:"B", status:0 },
  { id:"p9",  subject:"Programming",       institution:"Others",         code:"Advanced Java", name:"Advanced Java for Beginners",                                    source:"Youtube",  link:"https://www.youtube.com/results?search_query=Advanced+Java+for+Beginners+Complete+Java+Programming+Course+10+Hours",  lectures:"0/?",   priority:"B", status:0 },
  { id:"p10", subject:"Programming",       institution:"Others",         code:"OCaml",         name:"OCaml Programming: Correct + Efficient + Beautiful",             source:"Youtube",  link:"https://www.youtube.com/results?search_query=OCaml+Programming+Correct+Efficient+Beautiful",                             lectures:"0/?",   priority:"A", status:0 },
  { id:"p11", subject:"Programming",       institution:"Others",         code:"HTB",           name:"Linux (HTB)",                                                    source:"HTB",      link:"https://www.hackthebox.com",                                                                                                 lectures:"0/?",   priority:"B", status:0 },
  { id:"p12", subject:"Programming",       institution:"Others",         code:"HTB",           name:"Windows (HTB)",                                                  source:"HTB",      link:"https://www.hackthebox.com",                                                                                                 lectures:"0/?",   priority:"C", status:0 },
  { id:"p13", subject:"Programming",       institution:"Others",         code:"C++ Finance",   name:"C++ for Finance",                                                source:"Youtube",  link:"https://www.youtube.com/results?search_query=C+++for+finance",                                                              lectures:"0/?",   priority:"A", status:0 },
  { id:"p14", subject:"Programming",       institution:"Others",         code:"Core C++",      name:"Core C++ for HFT",                                               source:"Youtube",  link:"https://www.youtube.com/results?search_query=Core+C+++2024",                                                               lectures:"0/?",   priority:"A", status:0 },
  { id:"p15", subject:"Programming",       institution:"Others",         code:"Low Latency",   name:"Low Latency Systems in C++",                                     source:"Youtube",  link:"https://www.youtube.com/results?search_query=Trading+at+light+speed+designing+low+latency+systems+in+C+++David+Gross+Meeting+C+++2022", lectures:"0/?", priority:"A", status:0 },
  { id:"p16", subject:"Programming",       institution:"Others",         code:"Low Latency MD","name":"Low Latency Market Data",                                       source:"Youtube",  link:"https://www.youtube.com/results?search_query=Low+Latency+Market+Data",                                                    lectures:"0/?",   priority:"A", status:0 },
  { id:"p17", subject:"Programming",       institution:"Others",         code:"Trading Sys",   name:"Building Low Latency Trading Systems",                           source:"Youtube",  link:"https://www.youtube.com/results?search_query=Building+Low+Latency+Trading+Systems",                                      lectures:"0/?",   priority:"A", status:0 },
  { id:"p18", subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"PyTorch for Deep Learning & ML – Full Course",                   source:"Youtube",  link:"https://www.youtube.com/results?search_query=PyTorch+for+Deep+Learning+Machine+Learning+Full+Course+FreeCodeCamp",     lectures:"0/?",   priority:"A", status:0 },
  { id:"p19", subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"TensorFlow 2.0 Complete Course",                                 source:"Youtube",  link:"https://www.youtube.com/results?search_query=TensorFlow+2.0+Complete+Course+Python+Neural+Networks+for+Beginners+Tutorial", lectures:"0/?", priority:"A", status:0 },
  { id:"p20", subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"Python for Data Science – Full Course",                          source:"Youtube",  link:"https://www.youtube.com/results?search_query=Learn+Python+for+Data+Science+Full+Course+for+Beginners",                  lectures:"0/?",   priority:"A", status:0 },
  { id:"p21", subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"API Development (Full Course)",                                  source:"Youtube",  link:"https://www.youtube.com/watch?v=WXsD0ZgxjRw",                                                                            lectures:"0/?",   priority:"B", status:0 },
  { id:"p22", subject:"Programming",       institution:"FreeCodeCamp",   code:"FreeCodeCamp",  name:"Generative AI for Developers – Comprehensive Course",             source:"Youtube",  link:"https://www.youtube.com/results?search_query=Generative+AI+for+Developers+Comprehensive+Course+FreeCodeCamp",          lectures:"0/?",   priority:"B", status:0 },
  { id:"p23", subject:"Programming",       institution:"Others",         code:"Julia",         name:"Julia for Nervous Beginners",                                    source:"Youtube",  link:"https://www.youtube.com/results?search_query=Julia+Programming+For+Nervous+Beginners",                                   lectures:"0/25",  priority:"B", status:0 },
  { id:"p24", subject:"Programming",       institution:"Others",         code:"Julia Finance", name:"Introduction to Financial Simulation in Julia",                  source:"Youtube",  link:"https://www.youtube.com/results?search_query=Introducing+a+financial+simulation+ecosystem+in+Julia+Aaron+Wheeler+JuliaCon+2023", lectures:"0/?", priority:"B", status:0 },

  // ═══ MATHEMATICS ═══
  { id:"m0",  subject:"Mathematics",       institution:"MIT",            code:"MIT 18.01",     name:"Single Variable Calculus",                                       source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.01+Single+Variable+Calculus+Fall+2006",                               lectures:" 1/35", priority:"A", status:0 },
  { id:"m1",  subject:"Mathematics",       institution:"MIT",            code:"MIT 18.02",     name:"Multivariable Calculus",                                         source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.02+Multivariable+Calculus+Fall+2007",                               lectures:"0/35",  priority:"A", status:0 },
  { id:"m2",  subject:"Mathematics",       institution:"MIT",            code:"MIT 18.03",     name:"Differential Equations",                                         source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.03+Differential+Equations+Spring+2006",                             lectures:"0/33",  priority:"A", status:0 },
  { id:"m3",  subject:"Mathematics",       institution:"MIT",            code:"MIT 18.05",     name:"Introduction to Probability and Statistics",                     source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+18.05+probability+statistics",                                                          lectures:"0/?",   priority:"A", status:0 },
  { id:"m4",  subject:"Mathematics",       institution:"MIT",            code:"MIT 18.06",     name:"Linear Algebra",                                                 source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.06SC+Linear+Algebra+Fall+2011",                                     lectures:"70/70", priority:"A", status:0 },
  { id:"m5",  subject:"Mathematics",       institution:"MIT",            code:"MIT",           name:"Discrete Mathematics",                                           source:"Youtube",  link:"https://www.youtube.com/results?search_query=Discrete+Mathematics+Full+Course",                                          lectures:"0/?",   priority:"A", status:0 },
  { id:"m6",  subject:"Mathematics",       institution:"MIT",            code:"MIT 6.262",     name:"Discrete Stochastic Processes",                                  source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+6.262+Discrete+Stochastic+Processes+Spring+2011",                     lectures:"0/25",  priority:"A", status:0 },
  { id:"m7",  subject:"Mathematics",       institution:"NPTEL",          code:"NPTEL",         name:"Theory of Probability and Applications",                         source:"Youtube",  link:"https://www.youtube.com/results?search_query=Mathematics+Probability+Theory+and+Applications+NPTEL",                    lectures:"0/40",  priority:"A", status:0 },
  { id:"m8",  subject:"Mathematics",       institution:"MIT",            code:"MIT 18.175",    name:"Theory of Probability",                                          source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+18.175+theory+of+probability",                                                          lectures:"0/?",   priority:"A", status:0 },
  { id:"m9",  subject:"Mathematics",       institution:"MIT",            code:"MIT 18.065",    name:"Matrix Methods in Data Analysis, Signal Processing and ML",      source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.065+Matrix+Methods+in+Data+Analysis+Signal+Processing+Machine+Learning+Spring+2018", lectures:"0/36", priority:"A", status:0 },
  { id:"m10", subject:"Mathematics",       institution:"NPTEL",          code:"NPTEL",         name:"Nonlinear Programming",                                          source:"Youtube",  link:"https://www.youtube.com/results?search_query=Nonlinear+Programming+Prof+S.K.+Gupta+NPTEL",                               lectures:"0/20",  priority:"B", status:0 },
  { id:"m11", subject:"Mathematics",       institution:"MIT",            code:"MIT 6.252J",    name:"Nonlinear Programming (MIT)",                                    source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+6.252J+nonlinear+programming",                                                          lectures:"0/?",   priority:"B", status:0 },
  { id:"m12", subject:"Mathematics",       institution:"Others",         code:"Harvard 110",   name:"Probability and Distributions (Statistics 110)",                 source:"Youtube",  link:"https://www.youtube.com/results?search_query=Statistics+110+Probability+Harvard",                                        lectures:"14/35", priority:"A", status:0 },
  { id:"m13", subject:"Mathematics",       institution:"Others",         code:"Stoch Calc",    name:"Stochastic Calculus",                                            source:"Youtube",  link:"https://www.youtube.com/results?search_query=Stochastic+Calculus+probability+and+stochastics+for+finance",              lectures:"0/20",  priority:"A", status:0 },
  { id:"m14", subject:"Mathematics",       institution:"Others",         code:"Fractals",      name:"Introduction to Fractals",                                       source:"Youtube",  link:"https://www.youtube.com/results?search_query=Introduction+to+Fractals+Rivers+Eddie+Woo",                               lectures:"0/8",   priority:"C", status:0 },
  { id:"m15", subject:"Mathematics",       institution:"Others",         code:"Math Model",    name:"Mathematical Modelling and Simulation",                          source:"Youtube",  link:"https://www.youtube.com/results?search_query=Mathematical+Modeling+and+Simulation",                                      lectures:"0/28",  priority:"B", status:0 },
  { id:"m16", subject:"Mathematics",       institution:"Others",         code:"Math Model 2",  name:"Mathematical Modelling (Tutor Wizard)",                          source:"Youtube",  link:"https://www.youtube.com/results?search_query=Mathematical+Modeling+Tutor+Wizard",                                       lectures:"0/12",  priority:"B", status:0 },
  { id:"m17", subject:"Mathematics",       institution:"Others",         code:"EE230",         name:"Probability and Random Variables (EE230)",                       source:"Youtube",  link:"https://www.youtube.com/results?search_query=EE230+Probability+and+Random+Variables",                                   lectures:"0/40",  priority:"A", status:0 },
  { id:"m18", subject:"Mathematics",       institution:"MIT",            code:"MIT 18.440",    name:"Probability and Random Variables (MIT)",                         source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+18.440+probability+random+variables",                                                  lectures:"0/?",   priority:"A", status:0 },
  { id:"m19", subject:"Mathematics",       institution:"MIT",            code:"MIT 15.S50",    name:"Poker Theory and Analysis IAP",                                  source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+15.S50+Poker+Theory+and+Analysis+IAP+2015",                           lectures:"0/8",   priority:"B", status:0 },
  { id:"m20", subject:"Mathematics",       institution:"MIT",            code:"MIT 18.102",    name:"Functional Analysis",                                            source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.102+Introduction+to+Functional+Analysis+Spring+2021",              lectures:"0/23",  priority:"B", status:0 },
  { id:"m21", subject:"Mathematics",       institution:"Stanford",       code:"EE 261",        name:"Fourier Transform and Applications",                             source:"Youtube",  link:"https://www.youtube.com/results?search_query=Lecture+Collection+Fourier+Transforms+and+Applications+Stanford",          lectures:"0/30",  priority:"B", status:0 },
  { id:"m22", subject:"Mathematics",       institution:"NPTEL",          code:"NPTEL",         name:"Introduction to Fourier Analysis (NPTEL)",                       source:"Youtube",  link:"https://www.youtube.com/results?search_query=Introduction+to+Fourier+Analysis+NPTEL",                                   lectures:"0/60",  priority:"B", status:0 },
  { id:"m23", subject:"Mathematics",       institution:"MIT",            code:"MIT 18.103",    name:"Fourier Analysis (MIT)",                                         source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+18.103+Fourier+Analysis",                                                              lectures:"0/?",   priority:"B", status:0 },
  { id:"m24", subject:"Mathematics",       institution:"MIT",            code:"MIT 18.100",    name:"Real Analysis",                                                  source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.100A+Real+Analysis+Fall+2020",                                      lectures:"0/25",  priority:"B", status:0 },
  { id:"m25", subject:"Mathematics",       institution:"MIT",            code:"MIT 18.217",    name:"Graph Theory and Additive Combinatorics",                        source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.217+Graph+Theory+and+Additive+Combinatorics+Fall+2019",            lectures:"0/26",  priority:"B", status:0 },
  { id:"m26", subject:"Mathematics",       institution:"MIT",            code:"MIT 18.650",    name:"Statistics and Applications",                                    source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.650+Statistics+for+Applications+Fall+2016",                        lectures:"0/22",  priority:"A", status:0 },
  { id:"m27", subject:"Mathematics",       institution:"Others",         code:"UCB",           name:"Number Theory (Berkeley Math 115)",                              source:"Youtube",  link:"https://www.youtube.com/results?search_query=Introduction+to+number+theory+Berkeley+Math+115",                         lectures:"0/53",  priority:"C", status:0 },
  { id:"m28", subject:"Mathematics",       institution:"Others",         code:"Real Numbers",  name:"Real Numbers (Jane Street)",                                     source:"Youtube",  link:"https://www.youtube.com/results?search_query=Real+Numbers+Jane+Street",                                                  lectures:"0/16",  priority:"B", status:0 },
  { id:"m29", subject:"Mathematics",       institution:"Others",         code:"Measure Theory","name":"Measure Theory (Masters Programme)",                            source:"Youtube",  link:"https://www.youtube.com/results?search_query=Masters+Program+Measure+Theory+2018",                                      lectures:"0/35",  priority:"B", status:0 },

  // ═══ FINANCE & ECONOMICS ═══
  { id:"f0",  subject:"Finance & Economics",institution:"Yale",           code:"Econ 251",      name:"Financial Theory",                                               source:"Youtube",  link:"https://www.youtube.com/playlist?list=PLEDC55106E0BA18FC",                                                               lectures:"0/26",  priority:"A", status:0 },
  { id:"f1",  subject:"Finance & Economics",institution:"Yale",           code:"Econ 252",      name:"Financial Markets (Robert Shiller)",                             source:"Youtube",  link:"https://www.youtube.com/results?search_query=Financial+Markets+2011+with+Robert+Shiller",                             lectures:"23/23", priority:"A", status:0 },
  { id:"f2",  subject:"Finance & Economics",institution:"Yale",           code:"Econ 159",      name:"Game Theory",                                                    source:"Youtube",  link:"https://www.youtube.com/results?search_query=Game+Theory+Yale+ECON+159",                                               lectures:"24/24", priority:"A", status:0 },
  { id:"f3",  subject:"Finance & Economics",institution:"MIT",            code:"MIT 14.01",     name:"Principles of Microeconomics",                                   source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+14.01+Principles+of+Microeconomics+Fall+2023",                     lectures:"0/26",  priority:"B", status:0 },
  { id:"f4",  subject:"Finance & Economics",institution:"MIT",            code:"MIT 14.02",     name:"Principles of Macroeconomics",                                   source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+14.02+Principles+of+Macroeconomics+Spring+2023",                   lectures:"0/25",  priority:"B", status:0 },
  { id:"f5",  subject:"Finance & Economics",institution:"MIT",            code:"MIT 14.771",    name:"Development Economics",                                          source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+14.771+Development+Economics+Fall+2021",                            lectures:"0/25",  priority:"C", status:0 },
  { id:"f6",  subject:"Finance & Economics",institution:"Others",         code:"NPTEL",         name:"Quantitative Investment Management (NPTEL)",                     source:"Youtube",  link:"https://www.youtube.com/results?search_query=Quantitative+Investment+Management+NPTEL",                              lectures:"0/61",  priority:"A", status:0 },
  { id:"f7",  subject:"Finance & Economics",institution:"Others",         code:"NPTEL",         name:"Quantitative Finance (NPTEL)",                                   source:"Youtube",  link:"https://www.youtube.com/results?search_query=Quantitative+Finance+NPTEL",                                             lectures:"0/52",  priority:"A", status:0 },
  { id:"f8",  subject:"Finance & Economics",institution:"Others",         code:"Damodaran",     name:"Corporate Finance (Damodaran Spring 2025)",                      source:"Youtube",  link:"https://www.youtube.com/results?search_query=Corporate+Finance+Spring+2025+Damodaran",                              lectures:"0/27",  priority:"A", status:0 },
  { id:"f9",  subject:"Finance & Economics",institution:"Coursera",       code:"Coursera",      name:"Financial and Quantitative Modelling",                           source:"Coursera", link:"https://www.coursera.org/search?query=financial+quantitative+modelling",                                               lectures:"0/?",   priority:"A", status:0 },
  { id:"f10", subject:"Finance & Economics",institution:"MIT",            code:"MIT 14.13",     name:"Psychology and Economics",                                       source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+14.13+Psychology+and+Economics+Spring+2020",                       lectures:"0/24",  priority:"B", status:0 },
  { id:"f11", subject:"Finance & Economics",institution:"Coursera",       code:"Coursera",      name:"Accounting 1",                                                   source:"Coursera", link:"https://www.coursera.org/search?query=accounting+1",                                                                    lectures:"0/?",   priority:"B", status:0 },
  { id:"f12", subject:"Finance & Economics",institution:"Coursera",       code:"Coursera",      name:"Accounting 2",                                                   source:"Coursera", link:"https://www.coursera.org/search?query=accounting+2",                                                                    lectures:"0/?",   priority:"B", status:0 },
  { id:"f13", subject:"Finance & Economics",institution:"Coursera",       code:"Coursera",      name:"Financial Engineering and Risk Management",                      source:"Coursera", link:"https://www.coursera.org/search?query=financial+engineering+risk+management",                                         lectures:"0/?",   priority:"A", status:0 },
  { id:"f14", subject:"Finance & Economics",institution:"Others",         code:"Eco 421",       name:"Econometrics (Winter 2011)",                                     source:"Youtube",  link:"https://www.youtube.com/results?search_query=Economics+421+Econometrics+Winter+2011",                               lectures:"0/19",  priority:"A", status:0 },
  { id:"f15", subject:"Finance & Economics",institution:"Others",         code:"Eco 305",       name:"Money and Banking",                                              source:"Youtube",  link:"https://www.youtube.com/results?search_query=ECO+305+Money+and+Banking",                                             lectures:"0/40",  priority:"B", status:0 },
  { id:"f16", subject:"Finance & Economics",institution:"MIT",            code:"MIT 15.401",    name:"Finance Theory I",                                               source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+15.401+Finance+Theory+I+Fall+2008",                               lectures:"0/20",  priority:"A", status:0 },
  { id:"f17", subject:"Finance & Economics",institution:"MIT",            code:"MIT 15.414",    name:"Financial Management",                                           source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+15.414+financial+management",                                                       lectures:"0/?",   priority:"B", status:0 },
  { id:"f18", subject:"Finance & Economics",institution:"MIT",            code:"MIT 18.S096",   name:"Topics in Mathematics with Applications in Finance",             source:"MIT OCW",  link:"https://www.youtube.com/results?search_query=MIT+18.S096+Topics+in+Mathematics+with+Applications+in+Finance",     lectures:"0/24",  priority:"A", status:0 },
  { id:"f19", subject:"Finance & Economics",institution:"Others",         code:"NPTEL",         name:"Financial Statements Analysis and Reporting",                    source:"Youtube",  link:"https://www.youtube.com/results?search_query=Financial+Statement+Analysis+And+Reporting+NPTEL",                    lectures:"0/60",  priority:"B", status:0 },
  { id:"f20", subject:"Finance & Economics",institution:"MIT",            code:"MIT 15.S12",    name:"Blockchain and Money",                                           source:"MIT OCW",  link:"https://ocw.mit.edu/search/?q=MIT+15.S12+blockchain+money",                                                          lectures:"0/24",  priority:"B", status:0 },
  { id:"f21", subject:"Finance & Economics",institution:"Others",         code:"Damodaran",     name:"Valuation Undergraduate (Damodaran Spring 2025)",                source:"Youtube",  link:"https://www.youtube.com/results?search_query=Valuation+Undergraduate+Spring+2025+Damodaran",                       lectures:"0/28",  priority:"A", status:0 },
  { id:"f22", subject:"Finance & Economics",institution:"Others",         code:"NPTEL",         name:"Algorithmic Trading and Portfolio Management (NPTEL)",            source:"Youtube",  link:"https://www.youtube.com/results?search_query=Advanced+Algorithmic+Trading+and+Portfolio+Management+NPTEL",        lectures:"0/28",  priority:"A", status:0 },
  { id:"f23", subject:"Finance & Economics",institution:"Coursera",       code:"Coursera",      name:"Financial Accounting Fundamentals",                              source:"Coursera", link:"https://www.coursera.org/search?query=financial+accounting+fundamentals",                                             lectures:"0/?",   priority:"B", status:0 },
  { id:"f24", subject:"Finance & Economics",institution:"Others",         code:"Eco Applied",   name:"Applied Econometrics (Justin Eloring)",                          source:"Youtube",  link:"https://www.youtube.com/results?search_query=Applied+Econometrics",                                                  lectures:"0/21",  priority:"A", status:0 },
  { id:"f25", subject:"Finance & Economics",institution:"Others",         code:"NPTEL",         name:"Applied Econometrics (NPTEL)",                                   source:"Youtube",  link:"https://www.youtube.com/results?search_query=Applied+Econometrics+NPTEL",                                           lectures:"0/59",  priority:"A", status:0 },
]



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/competitions.js  (when splitting into separate files)
// Contains: competition events from 2026 Guide doc
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const COMPETITIONS = [
  // OPEN / CONFIRMED
  { id:"comp1", name:"IMC Prosperity 2026", org:"IMC Trading", deadline:"2026-03-15", start:"2026-03-20", end:"2026-04-15", mode:"Online", location:"Global", status:"open", category:"Algo Trading", prize:"$50,000", link:"https://prosperity.imc.com", desc:"Global Python algo trading competition. Manual + automated trading with live leaderboard." },
  { id:"comp2", name:"WorldQuant BRAIN IQC 2026", org:"WorldQuant", deadline:"2026-03-17", start:"2026-03-17", end:"2026-09-30", mode:"Online + In-Person Finals", location:"Global → Singapore", status:"open", category:"ML & Alpha Research", prize:"Cash + Full-Time", link:"https://platform.worldquantbrain.com/iqc", desc:"3-stage team competition. Build alpha models on BRAIN platform. Free to enter. Top teams fly to Singapore." },
  { id:"comp3", name:"Citadel Securities Quant Invitational", org:"Citadel Securities", deadline:"2026-03-06", start:"2026-04-15", end:"2026-04-18", mode:"In-Person", location:"London, UK", status:"open", category:"Quant Research", prize:"$10,000", link:"https://www.citadelsecurities.com/careers/programs-and-events/the-citadel-securities-quant-invitational/", desc:"Invite-only 3-day STEM challenge. Teams of 2 apply statistical techniques to financial datasets." },
  { id:"comp4", name:"Citadel Securities Trading Invitational NYC", org:"Citadel Securities", deadline:"2026-02-27", start:"2026-04-16", end:"2026-04-17", mode:"In-Person", location:"New York City, NY", status:"open", category:"Trading Simulation", prize:"Travel + Prizes", link:"https://www.citadelsecurities.com/careers/programs-and-events/the-trading-invitational/", desc:"First and second-year undergrad trading challenge. Live simulations. Travel & accommodation covered." },
  { id:"comp5", name:"Jane Street AMP 2026", org:"Jane Street", deadline:"2026-03-11", start:"2026-06-29", end:"2026-07-31", mode:"In-Person", location:"New York City, NY", status:"open", category:"Discovery Program", prize:"$5,000 scholarship", link:"https://www.janestreet.com/join-jane-street/programs-and-events/amp/", desc:"6-week program for 2026 HS graduates. Math, CS, probability, algorithmic thinking. Free + scholarship." },
  { id:"comp6", name:"Optiver Career Kickstarter: Tech", org:"Optiver", deadline:"2026-04-01", start:"2026-05-11", end:"2026-05-15", mode:"In-Person", location:"Amsterdam, Netherlands", status:"open", category:"Discovery Program", prize:"Potential Full-Time Offer", link:"https://optiver.com/recruitment-events/career-kickstarter-amsterdam/", desc:"5-day tech track: SWE in trading, low-latency systems. May lead to graduate full-time offer." },
  { id:"comp7", name:"Optiver Career Kickstarter: Trading", org:"Optiver", deadline:"2026-05-01", start:"2026-06-01", end:"2026-06-05", mode:"In-Person", location:"Amsterdam, Netherlands", status:"open", category:"Discovery Program", prize:"Potential Full-Time Offer", link:"https://optiver.com/recruitment-events/career-kickstarter-amsterdam/", desc:"5-day trading track: options pricing, market making, probability, risk management." },
  { id:"comp8", name:"Bank of America APAC Quant Conference", org:"Bank of America", deadline:"N/A", start:"2026-05-20", end:"2026-05-20", mode:"In-Person", location:"APAC (TBA)", status:"open", category:"Conference", prize:"—", link:"https://www.bofasecurities.com", desc:"Industry conference on quant strategies, financial modeling, and research trends in Asia-Pacific." },
  { id:"comp9", name:"Duke FinTech Trading Competition", org:"Duke University", deadline:"2026-01-25", start:"2026-02-01", end:"2026-05-01", mode:"Online + In-Person Finals", location:"Durham, NC", status:"open", category:"Algo Trading", prize:"Recognition + Sponsorships", link:"https://www.dukequant.com/general-7", desc:"3-month paper trading with bracket system. Portfolio management, systematic trading, quant strategy." },
  { id:"comp10", name:"Jane Street JSIP (Software Immersion)", org:"Jane Street", deadline:"2026-02-08", start:"2026-06-15", end:"2026-08-15", mode:"In-Person", location:"New York City, NY", status:"open", category:"Fellowship", prize:"Compensation", link:"https://www.janestreet.com/join-jane-street/programs-and-events/jsip/", desc:"8-week SWE immersion (diversity-focused). OCaml, functional programming, system design." },
  { id:"comp11", name:"Harvard Undergraduate Trading Competition", org:"Harvard HUQT", deadline:"2026-01-25", start:"2026-03-27", end:"2026-03-28", mode:"In-Person", location:"Cambridge, MA", status:"open", category:"Trading Simulation", prize:"$20,000+", link:"https://www.harvarduqt.com/competition", desc:"Interactive trading games: market making, betting, data analysis. Great for beginners. $20k+ prizes." },
  // TBA
  { id:"comp12", name:"UChicago Trading Competition (14th Annual)", org:"UChicago", deadline:"TBA", start:"2026-04-10", end:"2026-04-11", mode:"In-Person", location:"Chicago, IL", status:"tba", category:"Algo Trading", prize:"—", link:"https://tradingcompetition.uchicago.edu", desc:"One of oldest and most prestigious US trading competitions. Algo trading, options, market making." },
  { id:"comp13", name:"Jane Street FTTP (First-Year Program)", org:"Jane Street", deadline:"TBA", start:"2026-03-29", end:"2026-04-01", mode:"In-Person", location:"Hong Kong / NYC / London", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.janestreet.com/join-jane-street/programs-and-events/fttp/", desc:"For first-year undergrads. Interactive classes + mock trading simulation. No prior finance knowledge." },
  { id:"comp14", name:"Akuna Capital Trading Sneak Peek Week", org:"Akuna Capital", deadline:"Spring 2026 TBA", start:"2026-08-01", end:"2026-08-07", mode:"In-Person", location:"Chicago, IL", status:"tba", category:"Options & Market Making", prize:"—", link:"https://akunacapital.com/careers", desc:"Options trading crash course with Akuna traders. Risk management, game theory, optimal decision making." },
  { id:"comp15", name:"Battle of the Quants NYC", org:"Battle of the Quants", deadline:"TBA", start:"2026-04-15", end:"2026-04-15", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Conference", prize:"—", link:"https://www.battleofthequants.com", desc:"Quant finance conference: panels on systematic strategies, ML in finance, risk management." },
  { id:"comp16", name:"Battle of the Quants London", org:"Battle of the Quants", deadline:"TBA", start:"2026-09-15", end:"2026-09-15", mode:"In-Person", location:"London, UK", status:"tba", category:"Conference", prize:"—", link:"https://www.battleofthequants.com", desc:"European quant conference: systematic strategies, global macro quant, alternative data." },
  { id:"comp17", name:"Berkeley Trading Competition", org:"Traders at Berkeley", deadline:"TBA", start:"2026-02-20", end:"2026-02-21", mode:"In-Person", location:"Berkeley, CA", status:"tba", category:"Algo Trading", prize:"$20,000+", link:"https://traders.berkeley.edu/competition.html", desc:"Intercollegiate competition sponsored by Jane Street, Citadel, Optiver. Market making, algo trading." },
  { id:"comp18", name:"Bloomberg Global Trading Challenge", org:"Bloomberg", deadline:"TBA Fall", start:"2026-10-01", end:"2026-11-30", mode:"Online", location:"Global (Bloomberg Terminal)", status:"tba", category:"Portfolio Management", prize:"—", link:"https://www.bloomberg.com/professional/solution/bloomberg-trading-challenge/", desc:"Simulation-based portfolio management using Bloomberg Terminal. Equity research, risk management." },
  { id:"comp19", name:"Bridgewater Investment Immersion: Macro", org:"Bridgewater", deadline:"Rolling TBA", start:"2026-04-01", end:"2026-04-03", mode:"In-Person", location:"Westport, CT", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.bridgewater.com/bridgewater-immersion-macro-investing", desc:"Systematic macro investing: global macro modeling, All Weather strategy, economic principles." },
  { id:"comp20", name:"Bridgewater Rising Fellows Program", org:"Bridgewater", deadline:"TBA", start:"2026-06-01", end:"2026-08-31", mode:"In-Person", location:"Westport, CT", status:"tba", category:"Fellowship", prize:"Compensation", link:"https://www.bridgewater.com/careers", desc:"Fellowship at Bridgewater. Systematic investment research, macro modeling, economic analysis." },
  { id:"comp21", name:"Citadel Datathon / Data Open", org:"Citadel", deadline:"Multiple 2026", start:"2026-03-01", end:"2026-12-31", mode:"Hybrid", location:"Multiple Regions", status:"tba", category:"ML & Data Science", prize:"$50,000+", link:"https://www.citadel.com/careers/programs-and-events/datathons/", desc:"Large-scale data science competition. ML modeling, feature engineering on financial datasets." },
  { id:"comp22", name:"Citadel Terminal AI Competition", org:"Citadel Securities", deadline:"Open Year-Round", start:"2026-01-01", end:"2026-12-31", mode:"Online", location:"Global", status:"tba", category:"Competitive Programming", prize:"—", link:"https://terminal.c1games.com", desc:"AI strategy game: code algorithms to compete. Reinforcement learning, game theory, adversarial ML." },
  { id:"comp23", name:"CME Group University Trading Challenge", org:"CME Group", deadline:"TBA Jan-Feb", start:"2026-02-01", end:"2026-04-30", mode:"Online", location:"Global", status:"tba", category:"Options & Market Making", prize:"—", link:"https://www.cmegroup.com/education/", desc:"Simulated futures and options trading on CME's platform. Derivatives strategies, risk management." },
  { id:"comp24", name:"Cornell Quant Fund Trading Competition", org:"Cornell Quant Fund", deadline:"TBA Sep", start:"2026-10-14", end:"2026-10-14", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Algo Trading", prize:"$9,000", link:"https://cornellquantfund.org/competition", desc:"Options, crypto, or equities trading challenge at Cornell Tech NYC. Any student eligible." },
  { id:"comp25", name:"Cubist Systematic Strategies Hackathon", org:"Cubist", deadline:"TBA", start:"2026-06-01", end:"2026-06-01", mode:"In-Person", location:"New York City, NY", status:"tba", category:"ML & Data Science", prize:"Employment Opportunities", link:"https://www.point72.com/cubist", desc:"Build models from NYC Open Data. Winners get exclusive employment opportunities with Cubist." },
  { id:"comp26", name:"Cubist Quant Academy", org:"Cubist", deadline:"TBA", start:"2026-07-01", end:"2026-07-05", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.point72.com/cubist", desc:"Quant research academy hosted by Cubist Systematic Strategies. Research pipeline, alpha generation." },
  { id:"comp27", name:"AQR Early Engagement Day", org:"AQR Capital", deadline:"TBA", start:"2026-03-01", end:"2026-03-01", mode:"In-Person", location:"Greenwich, CT", status:"tba", category:"Discovery Program", prize:"Internship Track", link:"https://www.aqr.com/About-Us/Careers", desc:"For 1st and 2nd year undergrads. Learn from AQR senior leadership + inside track to summer internship." },
  { id:"comp28", name:"AQR Quanta Academy", org:"AQR Capital", deadline:"TBA", start:"2026-06-01", end:"2026-08-31", mode:"In-Person", location:"Greenwich, CT", status:"tba", category:"Fellowship", prize:"Compensation", link:"https://www.aqr.com/About-Us/Careers", desc:"Quantitative research academy at AQR. Factor models, systematic strategies, academic research." },
  { id:"comp29", name:"D.E. Shaw Discovery Fellowship", org:"D.E. Shaw", deadline:"TBA", start:"2026-06-01", end:"2026-08-31", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Fellowship", prize:"Compensation", link:"https://www.deshaw.com/careers", desc:"Quantitative finance, systematic strategies, computational approaches at D.E. Shaw." },
  { id:"comp30", name:"D.E. Shaw Latitude Fellowship", org:"D.E. Shaw", deadline:"TBA", start:"2026-06-01", end:"2026-08-31", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Fellowship", prize:"Compensation", link:"https://www.deshaw.com/careers", desc:"Research, quantitative modeling, and systematic investment strategies." },
  { id:"comp31", name:"D.E. Shaw Momentum Fellowship", org:"D.E. Shaw", deadline:"TBA", start:"2026-06-01", end:"2026-08-31", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Fellowship", prize:"Compensation", link:"https://www.deshaw.com/careers", desc:"Intro program: quantitative trading and systematic investment management at D.E. Shaw." },
  { id:"comp32", name:"D.E. Shaw Nexus Fellowship", org:"D.E. Shaw", deadline:"TBA", start:"2026-06-01", end:"2026-08-31", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Fellowship", prize:"Compensation", link:"https://www.deshaw.com/careers", desc:"Fellowship at intersection of CS, math, and finance. For mathematically strong candidates." },
  { id:"comp33", name:"Discover Citadel", org:"Citadel", deadline:"TBA", start:"2026-05-01", end:"2026-05-02", mode:"In-Person", location:"NYC + Other Locations", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.citadel.com/careers/programs-and-events/discover-citadel/apply/", desc:"Discovery event: Citadel culture, quant research, trading. Data science, quantitative analysis." },
  { id:"comp34", name:"Discover DRW", org:"DRW", deadline:"TBA", start:"2026-04-01", end:"2026-04-02", mode:"In-Person", location:"Chicago, IL / London", status:"tba", category:"Discovery Program", prize:"—", link:"https://drw.com/careers", desc:"Dynamic 2-day event immersing students in quantitative trading at DRW." },
  { id:"comp35", name:"Flow Traders E-House Day", org:"Flow Traders", deadline:"TBA", start:"2026-04-01", end:"2026-04-01", mode:"Virtual", location:"Online", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.flowtraders.com/careers", desc:"Interactive virtual opportunity to learn about ETFs and Flow's core business strategy." },
  { id:"comp36", name:"Flow Traders Trading Business Course", org:"Flow Traders", deadline:"TBA", start:"2026-05-01", end:"2026-05-03", mode:"In-Person", location:"Amsterdam, Netherlands", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.flowtraders.com/careers", desc:"In-depth trading course at Flow Traders HQ. ETF trading, market making, quantitative strategies." },
  { id:"comp37", name:"Hull Tactical Market Prediction (Kaggle)", org:"Hull Tactical", deadline:"TBA", start:"2026-05-01", end:"2026-06-30", mode:"Online", location:"Global", status:"tba", category:"ML & Data Science", prize:"—", link:"https://www.kaggle.com", desc:"ML competition on financial market prediction. Time-series forecasting with real market data." },
  { id:"comp38", name:"IAQF Paper Competition", org:"IAQF", deadline:"TBA Fall", start:"2025-09-01", end:"2026-05-01", mode:"Online + In-Person Finals", location:"Global", status:"tba", category:"Research", prize:"Cash Prizes", link:"https://iaqf.org", desc:"Academic paper competition on applied quant finance: risk, derivatives, or ML in finance." },
  { id:"comp39", name:"IMC EU Business Course", org:"IMC Trading", deadline:"TBA", start:"2026-05-01", end:"2026-05-03", mode:"In-Person", location:"Amsterdam, Netherlands", status:"tba", category:"Options & Market Making", prize:"—", link:"https://imc.com", desc:"Quant trading principles, market making, and financial strategies by IMC professionals." },
  { id:"comp40", name:"IMC Launchpad (Diversity)", org:"IMC Trading", deadline:"TBA", start:"2026-06-01", end:"2026-06-03", mode:"In-Person", location:"Amsterdam / Chicago", status:"tba", category:"Discovery Program", prize:"—", link:"https://imc.com/careers", desc:"Diversity discovery program: algorithmic trading, market microstructure, systematic finance." },
  { id:"comp41", name:"IMC Trading Competition (UK)", org:"IMC Trading", deadline:"TBA", start:"2026-05-01", end:"2026-05-01", mode:"In-Person", location:"London, UK", status:"tba", category:"Trading Simulation", prize:"—", link:"https://imc.com", desc:"UK trading competition: quant strategies, algorithmic trading, and market making by IMC." },
  { id:"comp42", name:"Jane Street INSIGHT Research Fellowship", org:"Jane Street", deadline:"TBA", start:"2026-06-01", end:"2026-08-31", mode:"In-Person", location:"London, UK (EMEA)", status:"tba", category:"Fellowship", prize:"Compensation", link:"https://www.janestreet.com/join-jane-street/programs-and-events/insight/", desc:"Research-oriented fellowship: quant research, systematic strategies, algorithm design in London." },
  { id:"comp43", name:"Jane Street SEE (Summer Engineering)", org:"Jane Street", deadline:"TBA", start:"2026-06-15", end:"2026-08-15", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Fellowship", prize:"Compensation", link:"https://www.janestreet.com/join-jane-street/programs-and-events/", desc:"Engineering discovery program: distributed systems, low-latency, functional programming." },
  { id:"comp44", name:"Jane Street WISE (Women in STEM)", org:"Jane Street", deadline:"TBA", start:"2026-06-01", end:"2026-06-05", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.janestreet.com/join-jane-street/programs-and-events/", desc:"Discovery for women in STEM: trading, technology, probability, and career development." },
  { id:"comp45", name:"Jane Street Market Data Forecasting (Kaggle)", org:"Jane Street", deadline:"Ongoing", start:"2026-01-01", end:"2026-12-31", mode:"Online", location:"Global", status:"tba", category:"ML & Data Science", prize:"Cash Prizes", link:"https://www.kaggle.com/competitions", desc:"ML competition on real Jane Street market data. Financial time-series prediction, feature selection." },
  { id:"comp46", name:"Optiver FutureFocus (AU/NZ)", org:"Optiver", deadline:"TBA", start:"2026-07-01", end:"2026-07-05", mode:"In-Person", location:"Sydney, Australia", status:"tba", category:"Discovery Program", prize:"—", link:"https://optiver.com/recruitment-events/futurefocus/", desc:"Immersive 5-day: quant research, trading strategy, SWE via live projects and simulations." },
  { id:"comp47", name:"Optiver FutureFocus (Singapore)", org:"Optiver", deadline:"TBA", start:"2026-06-01", end:"2026-06-05", mode:"In-Person", location:"Singapore", status:"tba", category:"Discovery Program", prize:"—", link:"https://optiver.com/recruitment-events", desc:"Singapore edition: systematic trading, research methodology, and engineering at Optiver." },
  { id:"comp48", name:"Princeton Quant Trading Conference", org:"Princeton", deadline:"TBA", start:"2026-02-20", end:"2026-02-20", mode:"In-Person", location:"Princeton, NJ", status:"tba", category:"Conference", prize:"—", link:"https://www.princetonquanttrading.org", desc:"Student-run conference: speakers from hedge funds and trading firms. Systematic strategies, career paths." },
  { id:"comp49", name:"QuantConnect Quant League", org:"QuantConnect", deadline:"Ongoing", start:"2026-01-01", end:"2026-12-31", mode:"Online", location:"Global", status:"tba", category:"Algo Trading", prize:"—", link:"https://www.quantconnect.com/competitions", desc:"Algo trading competitions using Lean engine. Backtesting, factor investing, systematic strategy." },
  { id:"comp50", name:"QuantVision 2026: Fordham's Quant Conf", org:"Fordham University", deadline:"TBA", start:"2026-03-15", end:"2026-03-15", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Conference", prize:"—", link:"https://www.eventbrite.com/e/quantvision-2026-fordhams-quantitative-conference-tickets-1720181371789", desc:"Student quant conference: panels on quantitative finance, algorithmic trading, ML in finance." },
  { id:"comp51", name:"Rotman International Trading Competition", org:"Rotman School", deadline:"TBA", start:"2026-02-15", end:"2026-02-17", mode:"In-Person", location:"Toronto, Canada", status:"tba", category:"Algo Trading", prize:"—", link:"https://www.rotman.utoronto.ca", desc:"40+ university competition using RIT Market Simulator. Algorithmic trading, ETF arbitrage, options." },
  { id:"comp52", name:"SIG Discovery: Quantitative Trading (Dublin)", org:"Susquehanna (SIG)", deadline:"TBA", start:"2026-06-01", end:"2026-06-03", mode:"In-Person", location:"Dublin, Ireland", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.sig.com/careers", desc:"Hands-on: options market making, probability theory, quantitative trading at Susquehanna." },
  { id:"comp53", name:"SIG Discovery: Women at Susquehanna (NYC)", org:"Susquehanna (SIG)", deadline:"TBA", start:"2026-05-01", end:"2026-05-01", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Discovery Program", prize:"—", link:"https://www.sig.com/careers", desc:"Women-focused: options market making, probability, game theory, and quantitative trading at SIG." },
  { id:"comp54", name:"Stevens HFT Competition", org:"Stevens Institute", deadline:"TBA", start:"2026-04-01", end:"2026-04-01", mode:"In-Person / Online", location:"Hoboken, NJ", status:"tba", category:"Options & Market Making", prize:"—", link:"https://www.stevens.edu", desc:"HFT competition: market microstructure, latency optimization, order book dynamics." },
  { id:"comp55", name:"Traders@MIT Competition", org:"Traders@MIT", deadline:"TBA", start:"2026-03-01", end:"2026-03-02", mode:"In-Person", location:"Cambridge, MA (MIT)", status:"tba", category:"Algo Trading", prize:"$20,000+", link:"https://traders.mit.edu", desc:"Annual intercollegiate trading competition. Two days of intensive market simulations." },
  { id:"comp56", name:"Two Sigma Financial Modeling Challenge", org:"Two Sigma", deadline:"TBA", start:"2026-05-01", end:"2026-06-30", mode:"Online", location:"Global", status:"tba", category:"ML & Data Science", prize:"Cash + Employment", link:"https://www.twosigma.com/academics/", desc:"Financial modeling and ML competition. Predictive modeling, feature engineering, systematic strategy." },
  { id:"comp57", name:"Wharton Global Quant Challenge", org:"Wharton School", deadline:"TBA", start:"2026-06-01", end:"2026-06-30", mode:"Online / Hybrid", location:"Global", status:"tba", category:"Portfolio Management", prize:"—", link:"https://wharton.upenn.edu", desc:"Quant investment strategies, portfolio construction, and risk modeling challenge from Wharton." },
  { id:"comp58", name:"WIQF Americas Conference", org:"WIQF", deadline:"TBA", start:"2026-09-01", end:"2026-09-01", mode:"In-Person", location:"New York City, NY", status:"tba", category:"Conference", prize:"—", link:"https://www.wiqf.org", desc:"Conference for women in quant finance: systematic strategies, derivatives, ML in finance." },
  { id:"comp59", name:"Quantiacs Global Quant Competition", org:"Quantiacs", deadline:"Ongoing", start:"2026-01-01", end:"2026-12-31", mode:"Online", location:"Global", status:"tba", category:"Algo Trading", prize:"Live Funding", link:"https://quantiacs.com", desc:"Algo trading with live funding potential. Trend-following, factor models, systematic strategies." },
  { id:"comp60", name:"Kalshi Trading Competition", org:"Kalshi", deadline:"TBA", start:"2026-06-01", end:"2026-06-30", mode:"Online", location:"Global", status:"tba", category:"Trading Simulation", prize:"$5,000 + Internship", link:"https://kalshi.com", desc:"Event contracts trading competition. Win $5k in Kalshi credits + potential internship opportunity." },
  // PAST / CLOSED
  { id:"comp61", name:"Jane Street IN FOCUS", org:"Jane Street", deadline:"Closed Oct 2025", start:"2026-01-15", end:"2026-01-18", mode:"In-Person", location:"New York City, NY", status:"closed", category:"Discovery Program", prize:"—", link:"https://www.janestreet.com/join-jane-street/programs-and-events/in-focus/", desc:"Past cohort. Diversity-focused: SWE, Trading, Strategy & Product tracks. Watch for next cycle." },
  { id:"comp62", name:"MIT Pokerbots 2026", org:"MIT", deadline:"Closed Jan 2026", start:"2026-01-20", end:"2026-01-31", mode:"Online + In-Person", location:"MIT, Cambridge MA", status:"closed", category:"Competitive Programming", prize:"—", link:"https://pokerbots.org", desc:"Algorithmic poker bot competition. Game theory, probabilistic reasoning, adversarial ML." },
  { id:"comp63", name:"Virtu Financial Women's Winternship", org:"Virtu Financial", deadline:"Closed", start:"2026-01-05", end:"2026-01-16", mode:"In-Person", location:"New York City, NY", status:"closed", category:"Discovery Program", prize:"—", link:"https://www.virtu.com/careers/", desc:"Women's program: trading, market structure, data analytics, visualization, regression modeling." },
]


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/interviewQuestions.js  (when splitting into separate files)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const INTERVIEW_QS = {
  "Probability & Stats": [
    "You flip a fair coin until you get two consecutive heads. What is the expected number of flips?",
    "What is the probability that a random variable from a standard normal distribution exceeds 1.96?",
    "You have a bag with 3 red and 5 blue balls. You draw 2 without replacement. What's the probability both are red?",
    "Explain the difference between Type I and Type II errors in hypothesis testing.",
    "What is the Central Limit Theorem and why is it important in finance?",
  ],
  "Options & Derivatives": [
    "Explain the Black-Scholes model assumptions and their real-world limitations.",
    "What happens to option value when implied volatility increases? Explain vega.",
    "A European call option has strike $100, stock price $95, T=1yr, r=5%, σ=20%. Is it in or out of the money?",
    "What is put-call parity? Derive it from first principles.",
    "Explain the concept of delta-hedging. How often should you rebalance?",
  ],
  "Market Making & Trading": [
    "You are a market maker in a stock. Bid is $99.90, Ask is $100.10. How do you set your spread?",
    "What is adverse selection in market making? How do you account for it?",
    "Explain the Kyle lambda and how it relates to market impact.",
    "You have a position in 100 shares long. The stock drops 3%. Walk me through your P&L and Greeks.",
    "What is a VWAP strategy and when would you use it vs. TWAP?",
  ],
  "Brainteasers": [
    "You have 8 balls, one is heavier. You have a balance scale. Find the heavy ball in 2 weighings.",
    "100 passengers board a plane. Passenger 1 sits in a random seat. Every other passenger sits in their seat if available, or a random seat. What's the probability passenger 100 sits in their seat?",
    "You have a 3L jug and a 5L jug. How do you measure exactly 4 liters?",
    "What is the sum of the series: 1/2 + 1/4 + 1/8 + ... to infinity?",
    "You roll two fair dice. Given that at least one die shows a 6, what's the probability both show 6?",
  ],
  "Python & Algorithms": [
    "Implement a function to compute the rolling Sharpe ratio of a return series using NumPy.",
    "Write a function to detect if a list of stock prices has any arbitrage opportunity in O(n) time.",
    "Implement a simple VWAP calculator given a list of (price, volume) tuples.",
    "What is the time complexity of quicksort in average and worst case? When would you avoid it?",
    "Explain how you would backtest a simple moving average crossover strategy in Python.",
  ],
  "ML for Finance": [
    "What is overfitting in financial ML models? How do you prevent it with time-series data?",
    "Explain the difference between cross-validation for tabular data vs. time-series data.",
    "What features would you engineer to predict next-day stock returns?",
    "Explain gradient boosting. Why is it popular in quantitative finance?",
    "What is the Sharpe ratio and how would you use it as a loss function for an ML model?",
  ],
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/platforms.js  (when splitting into separate files)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PLATFORMS = [
  { name:"QuantConnect (LEAN)", url:"https://www.quantconnect.com", desc:"Free algorithmic trading backtesting engine. Python/C#.", category:"Algo Trading" },
  { name:"WorldQuant BRAIN", url:"https://platform.worldquantbrain.com", desc:"Free alpha research platform. Build and test equity models.", category:"Alpha Research" },
  { name:"Quantiacs", url:"https://quantiacs.com", desc:"Free algo competition platform. Winners get live funding.", category:"Algo Trading" },
  { name:"Jane Street Puzzles", url:"https://www.janestreet.com/puzzles/", desc:"Monthly math/logic puzzles. Free, great interview prep.", category:"Interview Prep" },
  { name:"MIT OpenCourseWare", url:"https://ocw.mit.edu", desc:"Free MIT course materials, problem sets, lecture notes.", category:"Education" },
  { name:"NPTEL", url:"https://nptel.ac.in", desc:"Free IIT lectures on YouTube. Math, CS, Finance.", category:"Education" },
  { name:"Kaggle", url:"https://www.kaggle.com", desc:"Free ML competitions, datasets, notebooks.", category:"ML & Data Science" },
  { name:"LeetCode", url:"https://leetcode.com", desc:"Free DSA practice. Essential for quant coding rounds.", category:"Interview Prep" },
  { name:"arXiv q-fin", url:"https://arxiv.org/list/q-fin/recent", desc:"Free preprints on quantitative finance research.", category:"Research" },
  { name:"Wilmott Forums", url:"https://forum.wilmott.com", desc:"Free quant finance community. Theory, interviews, news.", category:"Community" },
  { name:"QuantLib", url:"https://www.quantlib.org", desc:"Open-source library for quantitative finance in C++/Python.", category:"Tools" },
  { name:"OpenBB Terminal", url:"https://openbb.co", desc:"Free open-source investment research platform.", category:"Tools" },
]

// ─────────────────────────────────────────────
//  QUANT FIRMS DATABASE  (150+ firms worldwide)
// ─────────────────────────────────────────────
// ── DATA: QUANT FIRMS ───────────────────────────────────────────────────────
// 500+ firms across HFT, Market Making, Quant Hedge Funds, Prop Trading,
// Investment Banks (Quant Desks), Algo Trading, Risk/Analytics, FinTech, Exchanges
// Fields: n(name), c(cities), co(country), t(type), l(careers link)
// To add a firm: append { n, c, co, t, l } to the array
const QUANT_FIRMS = [

  // ═══ HFT & MARKET MAKING ═══
  { n:"Jane Street",                       c:"NYC · London · Hong Kong · Singapore · Amsterdam",  co:"USA",          t:"HFT / Market Making",      l:"https://www.janestreet.com/join-jane-street/open-roles/" },
  { n:"Citadel Securities",                c:"Chicago · NYC · London · Dublin",                   co:"USA",          t:"HFT / Market Making",      l:"https://www.citadelsecurities.com/careers/open-opportunities/students/" },
  { n:"IMC Trading",                       c:"Amsterdam · Chicago · Sydney · Singapore",           co:"Netherlands",  t:"HFT / Market Making",      l:"https://imc.com/eu/career-opportunities/" },
  { n:"Optiver",                           c:"Amsterdam · Chicago · Sydney · Singapore · Shanghai",co:"Netherlands",  t:"HFT / Market Making",      l:"https://optiver.com/working-at-optiver/career-opportunities/" },
  { n:"Virtu Financial",                   c:"NYC · London · Singapore · Dublin",                  co:"USA",          t:"HFT / Market Making",      l:"https://www.virtu.com/careers/" },
  { n:"Hudson River Trading (HRT)",        c:"NYC · London · Singapore · Amsterdam",               co:"USA",          t:"HFT / Market Making",      l:"https://www.hudsonrivertrading.com/careers/" },
  { n:"Flow Traders",                      c:"Amsterdam · NYC · Singapore · Hong Kong · Chicago",  co:"Netherlands",  t:"HFT / ETF Market Making",  l:"https://www.flowtraders.com/careers/vacancies" },
  { n:"Jump Trading",                      c:"Chicago · NYC · London · Singapore · Shanghai",      co:"USA",          t:"HFT / Prop Trading",       l:"https://www.jumptrading.com/careers/" },
  { n:"Tower Research Capital",            c:"NYC · London · Singapore · Warsaw",                  co:"USA",          t:"HFT",                      l:"https://www.tower-research.com/careers/" },
  { n:"XTX Markets",                       c:"London · NYC · Tokyo · Singapore · Paris",           co:"UK",           t:"Algorithmic Market Making", l:"https://www.xtxmarkets.com/#careers" },
  { n:"DRW",                               c:"Chicago · NYC · London · Singapore · Amsterdam",     co:"USA",          t:"Prop Trading / HFT",       l:"https://drw.com/careers/" },
  { n:"Akuna Capital",                     c:"Chicago · Sydney · Singapore · Shanghai",            co:"USA",          t:"Options Market Making",    l:"https://akunacapital.com/careers" },
  { n:"Five Rings Capital",                c:"NYC",                                                co:"USA",          t:"HFT / Prop Trading",       l:"https://fiverings.com/jobs/" },
  { n:"Quantlab Financial",                c:"Houston · NYC",                                      co:"USA",          t:"HFT",                      l:"https://quantlab.com/careers/" },
  { n:"Chicago Trading Company (CTC)",     c:"Chicago · NYC",                                      co:"USA",          t:"Options Market Making",    l:"https://www.chicagotradingco.com/careers/" },
  { n:"Allston Trading",                   c:"Chicago",                                            co:"USA",          t:"HFT / Prop Trading",       l:"https://www.allstontrading.com/careers/" },
  { n:"Wolverine Trading",                 c:"Chicago",                                            co:"USA",          t:"Options Market Making",    l:"https://www.wolve.com/careers/" },
  { n:"Group One Trading",                 c:"Chicago · NYC",                                      co:"USA",          t:"Options Market Making",    l:"https://www.grouponetrading.com/careers" },
  { n:"Peak6 Investments",                 c:"Chicago · NYC",                                      co:"USA",          t:"Options / Prop Trading",   l:"https://www.peak6.com/careers/" },
  { n:"Belvedere Trading",                 c:"Chicago",                                            co:"USA",          t:"Options Market Making",    l:"https://www.belvederetrading.com/careers" },
  { n:"Old Mission Capital",               c:"Chicago · NYC",                                      co:"USA",          t:"Prop Trading",             l:"https://www.oldmissioncapital.com/careers/" },
  { n:"Headlands Technologies",            c:"San Francisco · Chicago",                            co:"USA",          t:"HFT",                      l:"https://www.headlandstech.com/careers/" },
  { n:"Teza Technologies",                 c:"Chicago · NYC",                                      co:"USA",          t:"HFT",                      l:"https://teza.com/careers/" },
  { n:"Maven Securities",                  c:"London · Singapore · Chicago",                       co:"UK",           t:"Prop Trading",             l:"https://www.mavensecurities.com/careers/" },
  { n:"RSJ Algorithmic Trading",           c:"Prague",                                             co:"Czech Republic",t:"HFT / Prop Trading",      l:"https://www.rsj.com/en/careers/" },
  { n:"Tibra Capital",                     c:"Sydney · London · Singapore",                        co:"Australia",    t:"Prop Trading / HFT",       l:"https://www.tibra.com/careers/" },
  { n:"GTS (Global Trading Systems)",      c:"NYC · London",                                       co:"USA",          t:"HFT / Market Making",      l:"https://www.gtsx.com/careers/" },
  { n:"Transmarket Group",                 c:"Chicago",                                            co:"USA",          t:"HFT / Prop Trading",       l:"https://www.transmarketgroup.com/careers/" },
  { n:"Spot Trading",                      c:"Chicago",                                            co:"USA",          t:"Prop Trading",             l:"https://www.spot-trading.com/careers" },
  { n:"Mako Global",                       c:"London · Singapore · Chicago · Sydney",              co:"UK",           t:"HFT / Market Making",      l:"https://www.mako.com/careers/" },
  { n:"Sun Trading",                       c:"Chicago · Singapore",                                co:"USA",          t:"HFT",                      l:"https://www.suntradingllc.com/careers" },
  { n:"Radix Trading",                     c:"Chicago",                                            co:"USA",          t:"Quant Prop Trading",       l:"https://www.radixtrading.com/careers" },
  { n:"HC Technologies",                   c:"NYC · London · Chicago",                             co:"USA",          t:"HFT",                      l:"https://www.hctech.com/careers" },
  { n:"Liquid Capital Group",              c:"Chicago · London",                                   co:"USA",          t:"Prop Trading / HFT",       l:"https://www.liquidcapitalgroup.com/careers" },
  { n:"3Red Partners",                     c:"Chicago",                                            co:"USA",          t:"Quant Prop Trading",       l:"https://www.3redpartners.com/careers" },
  { n:"Ronin Capital",                     c:"Chicago",                                            co:"USA",          t:"Options Market Making",    l:"https://ronincap.com/careers" },
  { n:"Catapult HFT",                      c:"Chicago",                                            co:"USA",          t:"HFT",                      l:"https://catapulthft.com/careers" },
  { n:"Getco (now KCG)",                   c:"Chicago · NYC · London",                             co:"USA",          t:"HFT",                      l:"https://www.getcollc.com" },
  { n:"KCG Holdings",                      c:"NYC · Jersey City",                                  co:"USA",          t:"HFT / Market Making",      l:"https://kcg.com" },
  { n:"Spire Trading",                     c:"Chicago",                                            co:"USA",          t:"Options Market Making",    l:"https://spiretrading.com/careers" },
  { n:"BT Squared",                        c:"Chicago · London",                                   co:"USA",          t:"Prop Trading",             l:"https://www.btsquared.com/careers" },
  { n:"CTC (Chicago Trading Co.)",         c:"Chicago",                                            co:"USA",          t:"Options Market Making",    l:"https://www.chicagotradingco.com/careers/" },
  { n:"HAP Capital",                       c:"NYC",                                                co:"USA",          t:"Quant Prop Trading",       l:"https://hapcap.com/careers" },
  { n:"Seven Eight Capital",               c:"NYC",                                                co:"USA",          t:"HFT",                      l:"https://www.seveneightcap.com/careers" },
  { n:"Nanoseconds (Nasdaq HFT)",          c:"NYC",                                                co:"USA",          t:"HFT Technology",           l:"https://www.nasdaq.com/careers" },

  // ═══ QUANT HEDGE FUNDS ═══
  { n:"Citadel LLC",                       c:"Chicago · NYC · London · Hong Kong · Singapore",     co:"USA",          t:"Quant Hedge Fund",         l:"https://www.citadel.com/careers/open-opportunities/students/" },
  { n:"Two Sigma",                         c:"NYC · London · Houston",                             co:"USA",          t:"Quant Hedge Fund",         l:"https://www.twosigma.com/careers/" },
  { n:"D.E. Shaw",                         c:"NYC · London · Hyderabad · Singapore",               co:"USA",          t:"Quant Hedge Fund",         l:"https://www.deshaw.com/careers/open-positions" },
  { n:"Renaissance Technologies",          c:"East Setauket NY",                                   co:"USA",          t:"Quant Hedge Fund",         l:"https://www.rentec.com/careers/" },
  { n:"AQR Capital Management",            c:"Greenwich CT · London · Hong Kong · Sydney",         co:"USA",          t:"Quant Hedge Fund",         l:"https://www.aqr.com/About-Us/Careers" },
  { n:"Bridgewater Associates",            c:"Westport CT",                                        co:"USA",          t:"Macro / Quant Fund",       l:"https://www.bridgewater.com/careers" },
  { n:"Man Group",                         c:"London · NYC · Hong Kong · Sydney · Singapore",      co:"UK",           t:"Quant Hedge Fund",         l:"https://www.man.com/careers" },
  { n:"Winton Group",                      c:"London · Hong Kong · Sydney",                        co:"UK",           t:"Quant Hedge Fund",         l:"https://www.winton.com/careers" },
  { n:"Point72 Asset Management",          c:"Stamford CT · NYC · London · Hong Kong",             co:"USA",          t:"Quant / Discretionary Fund",l:"https://point72.com/careers/" },
  { n:"Cubist Systematic Strategies",      c:"NYC",                                                co:"USA",          t:"Quant Hedge Fund",         l:"https://www.point72.com/cubist" },
  { n:"Millennium Management",             c:"NYC · London · Hong Kong · Singapore",               co:"USA",          t:"Multi-Strategy Hedge Fund", l:"https://www.mlp.com/careers/" },
  { n:"PDT Partners",                      c:"NYC",                                                co:"USA",          t:"Quant Hedge Fund",         l:"https://pdtpartners.com/careers.html" },
  { n:"WorldQuant",                        c:"NYC · London · Singapore · Warsaw",                  co:"USA",          t:"Quant Hedge Fund",         l:"https://www.worldquant.com/career-listing/" },
  { n:"Quantitative Investment Management (QIM)",c:"Charlottesville VA",                           co:"USA",          t:"Quant Hedge Fund",         l:"https://qimllc.com/careers/" },
  { n:"Systematica Investments",           c:"Geneva · London",                                    co:"Switzerland",  t:"Quant Hedge Fund",         l:"https://www.systematica.com/careers/" },
  { n:"Aspect Capital",                    c:"London",                                             co:"UK",           t:"Quant Hedge Fund",         l:"https://www.aspectcapital.com/careers/" },
  { n:"Algert Global",                     c:"San Francisco",                                      co:"USA",          t:"Quant Hedge Fund",         l:"https://algertglobal.com/careers/" },
  { n:"Cantab Capital Partners",           c:"Cambridge UK",                                       co:"UK",           t:"Quant Hedge Fund",         l:"https://cantabcapital.com/careers/" },
  { n:"Graham Capital Management",         c:"Rowayton CT",                                        co:"USA",          t:"Quant / Macro Fund",       l:"https://www.grahamcapital.com/careers.aspx" },
  { n:"Capula Investment Management",      c:"London · NYC · Singapore",                           co:"UK",           t:"Quant Fixed Income Fund",  l:"https://capula.com/careers/" },
  { n:"Markov Processes International",    c:"Summit NJ",                                          co:"USA",          t:"Quant Analytics",          l:"https://www.markovprocesses.com/careers/" },
  { n:"Alpha Simplex Group",               c:"Boston",                                             co:"USA",          t:"Quant Hedge Fund",         l:"https://www.alphasimplex.com/careers/" },
  { n:"Qube Research & Technologies",      c:"London · Hong Kong · Paris · Singapore",             co:"UK",           t:"Quant Hedge Fund",         l:"https://www.qube-rt.com/careers/" },
  { n:"Arrowstreet Capital",               c:"Boston",                                             co:"USA",          t:"Quant Hedge Fund",         l:"https://www.arrowstreetcapital.com/careers/" },
  { n:"Acadian Asset Management",          c:"Boston · London · Singapore",                        co:"USA",          t:"Quant Asset Management",   l:"https://www.acadian-asset.com/careers/" },
  { n:"PanAgora Asset Management",         c:"Boston",                                             co:"USA",          t:"Quant Asset Management",   l:"https://www.panagora.com/about/careers" },
  { n:"Numeric Investors",                 c:"Boston",                                             co:"USA",          t:"Quant Hedge Fund",         l:"https://numeric.com/careers" },
  { n:"GMO (Grantham Mayo)",               c:"Boston · London",                                    co:"USA",          t:"Quant / Value Fund",       l:"https://www.gmo.com/americas/about-us/careers/" },
  { n:"LSV Asset Management",              c:"Chicago",                                            co:"USA",          t:"Quant Asset Management",   l:"https://lsvasset.com/careers/" },
  { n:"GS Quantitative Investment Strategies",c:"NYC · London",                                    co:"USA",          t:"Quant Hedge Fund",         l:"https://www.goldmansachs.com/careers/" },
  { n:"Bayesian Capital Management",       c:"NYC",                                                co:"USA",          t:"Quant Hedge Fund",         l:"https://bayesiancapital.com" },
  { n:"Voloridge Investment Management",   c:"Jupiter FL",                                         co:"USA",          t:"Quant Hedge Fund",         l:"https://voloridge.com/careers/" },
  { n:"ExodusPoint Capital",               c:"NYC · London",                                       co:"USA",          t:"Multi-Strategy Quant",     l:"https://www.exoduspoint.com/careers/" },
  { n:"Schonfeld Strategic Advisors",      c:"NYC · London · Singapore",                           co:"USA",          t:"Multi-Strategy Hedge Fund", l:"https://www.schonfeld.com/careers/" },
  { n:"Balyasny Asset Management",         c:"Chicago · NYC · London",                             co:"USA",          t:"Multi-Strategy Hedge Fund", l:"https://www.balyasny.com/careers/" },
  { n:"Rokos Capital Management",          c:"London",                                             co:"UK",           t:"Macro Quant Fund",         l:"https://www.rokoscapital.com/careers/" },
  { n:"Ellington Management Group",        c:"Old Greenwich CT",                                   co:"USA",          t:"Quant Fixed Income",       l:"https://www.ellingtonmgmt.com/careers/" },
  { n:"Coatue Management",                 c:"NYC",                                                co:"USA",          t:"Quant / Tech Fund",        l:"https://www.coatue.com/careers/" },
  { n:"DE Shaw Valence (ESG Quant)",       c:"NYC",                                                co:"USA",          t:"Quant ESG Fund",           l:"https://www.deshaw.com/careers/open-positions" },
  { n:"Greenoaks Capital",                 c:"NYC · London",                                       co:"USA",          t:"Tech Quant Fund",          l:"https://www.greenoaks.com/careers" },
  { n:"Squarepoint Capital",               c:"London · NYC · Singapore",                           co:"UK",           t:"Quant Hedge Fund",         l:"https://www.squarepoint-capital.com/careers" },
  { n:"Freestone Grove Partners",          c:"NYC",                                                co:"USA",          t:"Quant Hedge Fund",         l:"https://freestonegrovelp.com" },
  { n:"Hutchin Hill Capital",              c:"NYC",                                                co:"USA",          t:"Quant Macro Fund",         l:"https://hutchinhill.com/careers" },

  // ═══ PROP TRADING FIRMS ═══
  { n:"Susquehanna International Group (SIG)",c:"Bala Cynwyd PA · Dublin · London · Hong Kong",   co:"USA",          t:"Options / Prop Trading",   l:"https://careers.sig.com/" },
  { n:"IMC Financial Markets",             c:"Amsterdam · Chicago · Sydney",                       co:"Netherlands",  t:"Prop Trading",             l:"https://imc.com/eu/career-opportunities/" },
  { n:"Simplex Investments",               c:"Tokyo · Hong Kong",                                  co:"Japan",        t:"Quant Prop Trading",       l:"https://www.simplexinvestments.com/careers" },
  { n:"Kershner Trading Group",            c:"Austin TX",                                          co:"USA",          t:"Prop Trading",             l:"https://kershnertrading.com/careers" },
  { n:"Trillium Trading",                  c:"NYC",                                                co:"USA",          t:"Prop Trading",             l:"https://www.trilliumtrading.com/careers" },
  { n:"T3 Trading Group",                  c:"NYC",                                                co:"USA",          t:"Prop Trading",             l:"https://www.t3trading.com/careers" },
  { n:"Avatar Securities",                 c:"NYC",                                                co:"USA",          t:"Prop Trading",             l:"https://www.avatarsecurities.com" },
  { n:"Maverick Capital",                  c:"Dallas · NYC · London",                              co:"USA",          t:"Prop / Quant Trading",     l:"https://www.maverickcap.com/careers" },
  { n:"SMB Capital",                       c:"NYC",                                                co:"USA",          t:"Prop Trading",             l:"https://www.smbtraining.com/careers" },
  { n:"Topstep",                           c:"Chicago",                                            co:"USA",          t:"Funded Prop Trading",      l:"https://www.topstep.com/careers/" },
  { n:"Bright Trading",                    c:"Las Vegas · NYC",                                    co:"USA",          t:"Prop Trading",             l:"https://www.stocktrading.com" },
  { n:"Geneva Trading",                    c:"Chicago · Dublin",                                   co:"USA",          t:"Prop Trading / HFT",       l:"https://genevatrading.com/careers/" },
  { n:"Phibro LLC",                        c:"Westport CT",                                        co:"USA",          t:"Commodity Prop Trading",   l:"https://www.phibrocorporation.com/careers" },
  { n:"Marex Spectron",                    c:"London · NYC · Chicago · Singapore",                 co:"UK",           t:"Commodity Prop Trading",   l:"https://www.marex.com/careers/" },
  { n:"Vitol",                             c:"London · Geneva · Houston · Singapore",               co:"UK",           t:"Commodity Trading",        l:"https://www.vitol.com/careers/" },
  { n:"Trafigura",                         c:"Singapore · Geneva · Houston · London",               co:"Singapore",    t:"Commodity Trading",        l:"https://www.trafigura.com/careers/" },
  { n:"Glencore",                          c:"Baar Switzerland · London · NYC",                    co:"Switzerland",  t:"Commodity Trading",        l:"https://www.glencore.com/careers" },
  { n:"Gunvor Group",                      c:"Geneva · Singapore",                                  co:"Switzerland",  t:"Commodity Prop Trading",   l:"https://www.gunvorgroup.com/careers/" },
  { n:"Freepoint Commodities",             c:"Stamford CT",                                        co:"USA",          t:"Commodity Prop Trading",   l:"https://www.freepointcommodities.com/careers" },
  { n:"Hartree Partners",                  c:"NYC · London · Houston",                             co:"USA",          t:"Commodity Prop Trading",   l:"https://www.hartreepartners.com/careers" },

  // ═══ INVESTMENT BANKS – QUANT DESKS ═══
  { n:"Goldman Sachs (Strats & Quant)",    c:"NYC · London · Hong Kong · Singapore · Tokyo",       co:"USA",          t:"Investment Bank – Quant",  l:"https://www.goldmansachs.com/careers/" },
  { n:"Morgan Stanley (Global Quant)",     c:"NYC · London · Hong Kong · Tokyo · Sydney",          co:"USA",          t:"Investment Bank – Quant",  l:"https://www.morganstanley.com/people-opportunities/students-graduates" },
  { n:"J.P. Morgan (Global Markets Quant)",c:"NYC · London · Hong Kong · Singapore",               co:"USA",          t:"Investment Bank – Quant",  l:"https://careers.jpmorgan.com/global/en/students" },
  { n:"Barclays (Global Markets Quant)",   c:"London · NYC · Singapore",                           co:"UK",           t:"Investment Bank – Quant",  l:"https://home.barclays/careers/" },
  { n:"Deutsche Bank (Quantitative Strategies)",c:"Frankfurt · London · NYC",                      co:"Germany",      t:"Investment Bank – Quant",  l:"https://careers.db.com/" },
  { n:"UBS (Quant Research)",              c:"Zurich · London · NYC · Hong Kong",                  co:"Switzerland",  t:"Investment Bank – Quant",  l:"https://www.ubs.com/global/en/careers.html" },
  { n:"Credit Suisse (QIS)",               c:"Zurich · London · NYC",                              co:"Switzerland",  t:"Investment Bank – Quant",  l:"https://www.credit-suisse.com/careers" },
  { n:"BNP Paribas (Global Markets Quant)",c:"Paris · London · NYC · Singapore",                   co:"France",       t:"Investment Bank – Quant",  l:"https://group.bnpparibas/en/careers" },
  { n:"Société Générale (SG CIB Quant)",   c:"Paris · London · NYC · Hong Kong",                   co:"France",       t:"Investment Bank – Quant",  l:"https://careers.societegenerale.com/" },
  { n:"Nomura (Quant Research)",           c:"Tokyo · London · NYC · Hong Kong",                   co:"Japan",        t:"Investment Bank – Quant",  l:"https://www.nomura.com/careers/" },
  { n:"Citi (Quantitative Analysis)",      c:"NYC · London · Singapore · Hong Kong",               co:"USA",          t:"Investment Bank – Quant",  l:"https://jobs.citi.com/" },
  { n:"HSBC (Quant Research)",             c:"London · Hong Kong · NYC",                           co:"UK",           t:"Investment Bank – Quant",  l:"https://www.hsbc.com/careers" },
  { n:"Macquarie (Quant Trading)",         c:"Sydney · London · NYC · Singapore",                  co:"Australia",    t:"Investment Bank – Quant",  l:"https://www.macquarie.com/au/en/careers.html" },
  { n:"Bank of America (Quant Strategies)",c:"NYC · London · Charlotte NC",                        co:"USA",          t:"Investment Bank – Quant",  l:"https://careers.bankofamerica.com/" },
  { n:"Wells Fargo (Quant Analytics)",     c:"NYC · Charlotte NC · San Francisco",                 co:"USA",          t:"Investment Bank – Quant",  l:"https://www.wellsfargojobs.com/" },
  { n:"Mizuho Securities (Quant)",         c:"NYC · Tokyo · London",                               co:"Japan",        t:"Investment Bank – Quant",  l:"https://www.mizuho-sc.com/careers/" },
  { n:"RBC Capital Markets (Quant)",       c:"Toronto · NYC · London",                             co:"Canada",       t:"Investment Bank – Quant",  l:"https://jobs.rbcroyalbank.com/careers" },
  { n:"TD Securities (Quant)",             c:"Toronto · NYC · London",                             co:"Canada",       t:"Investment Bank – Quant",  l:"https://jobs.td.com/en-CA/" },
  { n:"CIBC Capital Markets (Quant)",      c:"Toronto · NYC · London",                             co:"Canada",       t:"Investment Bank – Quant",  l:"https://jobs.cibc.com/" },
  { n:"Natixis (Quant Research)",          c:"Paris · NYC · London",                               co:"France",       t:"Investment Bank – Quant",  l:"https://careers.natixis.com/" },
  { n:"ABN AMRO Clearing (Quant)",         c:"Amsterdam · Chicago · Singapore",                    co:"Netherlands",  t:"Clearing / Quant",         l:"https://jobs.abnamro.com/" },
  { n:"ING Wholesale Banking (Quant)",     c:"Amsterdam · London · NYC",                           co:"Netherlands",  t:"Investment Bank – Quant",  l:"https://www.ing.jobs/" },
  { n:"Rabobank (Quant Derivatives)",      c:"Utrecht · London · NYC",                             co:"Netherlands",  t:"Investment Bank – Quant",  l:"https://jobs.rabobank.com/" },
  { n:"Standard Chartered (Quant)",        c:"London · Singapore · Hong Kong",                     co:"UK",           t:"Investment Bank – Quant",  l:"https://www.sc.com/en/careers/" },
  { n:"Credit Agricole CIB (Quant)",       c:"Paris · London · NYC · Hong Kong",                   co:"France",       t:"Investment Bank – Quant",  l:"https://careers.credit-agricole-cib.com/" },
  { n:"BBVA (Global Markets Quant)",       c:"Madrid · NYC · London",                              co:"Spain",        t:"Investment Bank – Quant",  l:"https://careers.bbva.com/" },
  { n:"Santander (Quant Research)",        c:"Madrid · London · NYC · Sao Paulo",                  co:"Spain",        t:"Investment Bank – Quant",  l:"https://jobs.santander.com/" },
  { n:"UniCredit (Quant Strategies)",      c:"Milan · Munich · London · NYC",                      co:"Italy",        t:"Investment Bank – Quant",  l:"https://careers.unicreditgroup.eu/" },
  { n:"Commerzbank (Quant Research)",      c:"Frankfurt · London · NYC",                           co:"Germany",      t:"Investment Bank – Quant",  l:"https://www.commerzbank.de/portal/en/careers.html" },

  // ═══ ASSET MANAGERS – QUANT ═══
  { n:"BlackRock (Systematic Active Equity)",c:"NYC · London · San Francisco · Singapore",         co:"USA",          t:"Quant Asset Management",   l:"https://careers.blackrock.com/" },
  { n:"Vanguard (Quantitative Equity Group)",c:"Valley Forge PA",                                  co:"USA",          t:"Quant Asset Management",   l:"https://www.vanguardjobs.com/" },
  { n:"Fidelity Investments (Systematic)",  c:"Boston · NYC · London",                             co:"USA",          t:"Quant Asset Management",   l:"https://jobs.fidelity.com/" },
  { n:"PIMCO (Quant Strategies)",           c:"Newport Beach · London · Singapore · Tokyo",        co:"USA",          t:"Fixed Income Quant",       l:"https://www.pimco.com/gbl/en/careers/" },
  { n:"Dimensional Fund Advisors",          c:"Austin TX · London · Sydney · Singapore",           co:"USA",          t:"Quant Asset Management",   l:"https://www.dimensional.com/us-en/careers" },
  { n:"Robeco",                             c:"Rotterdam · NYC · London · Singapore",               co:"Netherlands",  t:"Quant Asset Management",   l:"https://www.robeco.com/en-int/about-us/jobs-at-robeco" },
  { n:"Invesco (Quantitative Strategies)",  c:"Atlanta · NYC · London · Hong Kong",                co:"USA",          t:"Quant Asset Management",   l:"https://www.invesco.com/us/en/careers.html" },
  { n:"State Street Global Advisors (Quant)",c:"Boston · London · Sydney · Hong Kong",             co:"USA",          t:"Quant Asset Management",   l:"https://www.statestreet.com/us/en/individual/about/careers" },
  { n:"Northern Trust Asset Management",    c:"Chicago · London · Singapore",                      co:"USA",          t:"Quant Asset Management",   l:"https://www.northerntrust.com/united-states/careers" },
  { n:"Nuveen (TIAA Quant)",                c:"NYC · Chicago",                                     co:"USA",          t:"Quant Asset Management",   l:"https://www.nuveen.com/en-us/careers" },
  { n:"T. Rowe Price (Quant Equity)",       c:"Baltimore · London · Singapore",                    co:"USA",          t:"Quant Asset Management",   l:"https://careers.troweprice.com/" },
  { n:"Wellington Management (Quant)",      c:"Boston · London · Singapore",                       co:"USA",          t:"Quant Asset Management",   l:"https://www.wellington.com/en/careers/" },
  { n:"Causeway Capital Management",        c:"Los Angeles",                                       co:"USA",          t:"Quant Asset Management",   l:"https://www.causewaycap.com/careers" },
  { n:"Analytic Investors",                 c:"Los Angeles",                                       co:"USA",          t:"Quant Asset Management",   l:"https://www.analyticinvestors.com/careers" },
  { n:"Harris Associates (Quant)",          c:"Chicago",                                           co:"USA",          t:"Quant Value Investing",    l:"https://www.harrisassoc.com/careers" },
  { n:"Columbia Threadneedle (Quant)",      c:"London · NYC · Boston",                             co:"UK",           t:"Quant Asset Management",   l:"https://www.columbiathreadneedle.com/en/careers/" },
  { n:"Schroders (Quant Equity)",           c:"London · NYC · Singapore",                          co:"UK",           t:"Quant Asset Management",   l:"https://www.schroders.com/en-gb/uk/individual/about-us/careers/" },
  { n:"Legal & General Investment Mgmt",    c:"London · Chicago · Hong Kong",                      co:"UK",           t:"Quant Asset Management",   l:"https://www.lgim.com/uk/en/capabilities/careers/" },
  { n:"Pictet Asset Management (Quant)",    c:"Geneva · London · Singapore",                       co:"Switzerland",  t:"Quant Asset Management",   l:"https://www.pictet.com/en/about-us/careers.html" },
  { n:"Unigestion (Quant)",                 c:"Geneva · London · NYC",                             co:"Switzerland",  t:"Quant Asset Management",   l:"https://www.unigestion.com/about-us/careers/" },

  // ═══ RISK, ANALYTICS & FINTECH ═══
  { n:"Bloomberg",                          c:"NYC · London · Tokyo · Singapore · Hong Kong",       co:"USA",          t:"Financial Data & Analytics",l:"https://careers.bloomberg.com/" },
  { n:"Refinitiv (LSEG)",                   c:"London · NYC · Singapore · Tokyo",                  co:"UK",           t:"Financial Data & Analytics",l:"https://careers.lseg.com/" },
  { n:"FactSet Research Systems",           c:"Norwalk CT · NYC · London · Hong Kong",             co:"USA",          t:"Financial Analytics",      l:"https://www.factset.com/careers" },
  { n:"MSCI",                               c:"NYC · London · Mumbai · Hong Kong",                  co:"USA",          t:"Risk & Analytics",         l:"https://www.msci.com/careers" },
  { n:"S&P Global (Quant Research)",        c:"NYC · London · Hyderabad",                          co:"USA",          t:"Financial Data & Ratings", l:"https://careers.spglobal.com/" },
  { n:"Moody's Analytics (Quant)",          c:"NYC · London · Hong Kong",                          co:"USA",          t:"Risk Analytics",           l:"https://careers.moodys.com/" },
  { n:"Fitch Ratings (Quant)",              c:"NYC · London",                                      co:"USA",          t:"Credit Analytics",         l:"https://www.fitchgroup.com/careers" },
  { n:"QuantConnect",                       c:"Remote",                                             co:"USA",          t:"Quant Platform / FinTech", l:"https://www.quantconnect.com/jobs" },
  { n:"Numerai",                            c:"San Francisco",                                      co:"USA",          t:"Crowd-Sourced Quant Fund", l:"https://numer.ai/about" },
  { n:"WorldQuant BRAIN",                   c:"NYC · Singapore",                                    co:"USA",          t:"Quant Research Platform",  l:"https://www.worldquant.com/career-listing/" },
  { n:"Quantiacs",                          c:"Munich",                                             co:"Germany",      t:"Quant Competition Platform",l:"https://quantiacs.com" },
  { n:"Kensho Technologies (S&P)",          c:"Cambridge MA · NYC",                                co:"USA",          t:"AI / Quant Analytics",     l:"https://www.kensho.com/careers" },
  { n:"Palantir Technologies",              c:"Denver · NYC · London · Singapore",                  co:"USA",          t:"Data Analytics / Defence",  l:"https://www.palantir.com/careers/" },
  { n:"Databricks",                         c:"San Francisco · Amsterdam · London",                 co:"USA",          t:"Data Platform for Finance", l:"https://www.databricks.com/company/careers" },
  { n:"Snowflake (Financial Services)",     c:"San Mateo CA · Boston · London",                    co:"USA",          t:"Cloud Data Platform",      l:"https://careers.snowflake.com/" },
  { n:"Axioma (Qontigo)",                   c:"NYC · London · Atlanta · Singapore",                 co:"USA",          t:"Risk & Portfolio Analytics",l:"https://qontigo.com/about-us/careers/" },
  { n:"Barra (MSCI Risk Models)",           c:"Berkeley CA · NYC · London",                        co:"USA",          t:"Risk Model Provider",      l:"https://www.msci.com/careers" },
  { n:"SunGard (FIS)",                      c:"Atlanta · NYC · London · Pune",                     co:"USA",          t:"Financial Technology",     l:"https://www.fisglobal.com/en/about-fis/careers" },
  { n:"Murex",                              c:"Paris · NYC · Singapore · Beirut",                  co:"France",       t:"Capital Markets FinTech",  l:"https://www.murex.com/careers/" },
  { n:"Finastra",                           c:"London · NYC · Toronto · Singapore",                 co:"UK",           t:"Financial Technology",     l:"https://www.finastra.com/careers" },
  { n:"Temenos",                            c:"Geneva · London · NYC",                              co:"Switzerland",  t:"Banking Software",         l:"https://www.temenos.com/careers/" },
  { n:"ION Group",                          c:"Dublin · London · NYC · Singapore",                  co:"Ireland",      t:"Commodity & Capital Markets Tech",l:"https://iongroupcareers.com/" },
  { n:"FIS Global",                         c:"Jacksonville FL · NYC · London",                    co:"USA",          t:"Financial Technology",     l:"https://www.fisglobal.com/en/about-fis/careers" },
  { n:"Broadridge Financial Solutions",     c:"NYC · London · Toronto",                             co:"USA",          t:"Financial Technology",     l:"https://www.broadridge.com/careers" },
  { n:"SS&C Technologies",                  c:"Windsor CT · NYC · London · Singapore",              co:"USA",          t:"Financial Technology",     l:"https://www.ssctech.com/company/careers" },
  { n:"OpenGamma",                          c:"London · NYC",                                       co:"UK",           t:"Derivatives Analytics",    l:"https://opengamma.com/careers/" },
  { n:"Numerix",                            c:"NYC · London · Singapore",                           co:"USA",          t:"Derivatives Risk Analytics",l:"https://www.numerix.com/company/careers" },
  { n:"Risk Dynamics (McKinsey)",           c:"Brussels · London · NYC",                            co:"Belgium",      t:"Risk Analytics Consulting",l:"https://www.mckinsey.com/careers" },
  { n:"Alpha Theory",                       c:"NYC",                                                co:"USA",          t:"Portfolio Analytics",      l:"https://www.alphatheory.com/careers" },
  { n:"QuantLib (open-source)",             c:"Remote / Global",                                    co:"Global",       t:"Open-Source Quant Library", l:"https://www.quantlib.org" },

  // ═══ MARKET DATA & INFRASTRUCTURE ═══
  { n:"Databento",                          c:"Remote · NYC · London",                              co:"USA",          t:"Market Data API",          l:"https://databento.com/careers" },
  { n:"ICE Data Services",                  c:"Atlanta · NYC · London",                             co:"USA",          t:"Market Data / Exchange",   l:"https://www.ice.com/careers" },
  { n:"Quandl (Nasdaq)",                    c:"Toronto · NYC",                                      co:"Canada",       t:"Alternative Data",         l:"https://www.quandl.com/careers" },
  { n:"Intrinio",                           c:"St. Petersburg FL",                                  co:"USA",          t:"Financial Data API",       l:"https://intrinio.com/company/careers" },
  { n:"Tiingo",                             c:"Remote",                                             co:"USA",          t:"Financial Data Platform",  l:"https://www.tiingo.com" },
  { n:"Alpha Vantage",                      c:"Remote",                                             co:"USA",          t:"Market Data API",          l:"https://www.alphavantage.co" },
  { n:"Polygon.io",                         c:"Remote",                                             co:"USA",          t:"Market Data API",          l:"https://polygon.io/careers" },
  { n:"Refinitiv Eikon (LSEG)",             c:"London · NYC · Singapore",                           co:"UK",           t:"Market Data Terminal",     l:"https://careers.lseg.com/" },
  { n:"SIX Group",                          c:"Zurich · London · Singapore",                        co:"Switzerland",  t:"Financial Market Data",    l:"https://www.six-group.com/en/company/careers.html" },
  { n:"Telekurs (SIX Financial)",           c:"Zurich",                                             co:"Switzerland",  t:"Financial Data",           l:"https://www.six-group.com/en/company/careers.html" },
  { n:"Edgar Online (DFIN)",                c:"Washington DC",                                      co:"USA",          t:"SEC Data / Regulatory",    l:"https://www.dfinsolutions.com/careers" },

  // ═══ EXCHANGES & CLEARING ═══
  { n:"CME Group",                          c:"Chicago · NYC · London",                             co:"USA",          t:"Exchange / Clearing",      l:"https://www.cmegroup.com/company/careers.html" },
  { n:"Intercontinental Exchange (ICE)",    c:"Atlanta · NYC · London · Singapore",                 co:"USA",          t:"Exchange / Clearing",      l:"https://www.ice.com/careers" },
  { n:"Nasdaq",                             c:"NYC · Stockholm · London · Singapore",               co:"USA",          t:"Exchange / Technology",    l:"https://www.nasdaq.com/careers" },
  { n:"London Stock Exchange Group (LSEG)", c:"London · NYC · Milan · Singapore",                  co:"UK",           t:"Exchange / Analytics",     l:"https://careers.lseg.com/" },
  { n:"Euronext",                           c:"Amsterdam · Paris · Dublin · Lisbon · Oslo",         co:"Netherlands",  t:"Exchange",                 l:"https://www.euronext.com/en/careers" },
  { n:"Deutsche Börse Group",               c:"Frankfurt · Luxembourg · Singapore",                 co:"Germany",      t:"Exchange / Infrastructure", l:"https://www.deutsche-boerse.com/dbg-en/careers" },
  { n:"Hong Kong Exchanges (HKEX)",         c:"Hong Kong",                                          co:"Hong Kong",    t:"Exchange",                 l:"https://www.hkex.com.hk/About-HKEX/Careers" },
  { n:"Singapore Exchange (SGX)",           c:"Singapore",                                          co:"Singapore",    t:"Exchange",                 l:"https://www.sgx.com/careers" },
  { n:"Australian Securities Exchange (ASX)",c:"Sydney · Melbourne",                                co:"Australia",    t:"Exchange",                 l:"https://www.asx.com.au/about/careers.htm" },
  { n:"Cboe Global Markets",                c:"Chicago · London · Amsterdam",                       co:"USA",          t:"Options Exchange",         l:"https://www.cboe.com/careers/" },
  { n:"Options Clearing Corporation (OCC)", c:"Chicago",                                            co:"USA",          t:"Options Clearing",         l:"https://www.theocc.com/company-information/careers" },
  { n:"DTCC",                               c:"NYC · Tampa FL · Wrexham UK",                        co:"USA",          t:"Clearing & Settlement",    l:"https://www.dtcc.com/careers" },
  { n:"LME (London Metal Exchange)",        c:"London",                                             co:"UK",           t:"Commodity Exchange",       l:"https://www.lme.com/en/about-lme/careers" },
  { n:"Borsa Istanbul",                     c:"Istanbul",                                           co:"Turkey",       t:"Exchange",                 l:"https://www.borsaistanbul.com/en/careers" },
  { n:"Johannesburg Stock Exchange (JSE)",  c:"Johannesburg",                                       co:"South Africa", t:"Exchange",                 l:"https://www.jse.co.za/about/careers" },

  // ═══ CRYPTO & DIGITAL ASSET ═══
  { n:"Wintermute",                         c:"London · Singapore · NYC",                           co:"UK",           t:"Crypto Market Making",     l:"https://www.wintermute.com/careers" },
  { n:"Cumberland DRW",                     c:"Chicago · Singapore",                                co:"USA",          t:"Crypto Market Making",     l:"https://cumberland.io/careers" },
  { n:"GSR Markets",                        c:"London · Singapore · Hong Kong",                     co:"UK",           t:"Crypto Market Making",     l:"https://www.gsr.io/careers/" },
  { n:"Jump Crypto",                        c:"Chicago · NYC",                                      co:"USA",          t:"Crypto Trading / HFT",     l:"https://jumpcrypto.com/careers/" },
  { n:"Amber Group",                        c:"Hong Kong · Singapore · London",                     co:"Hong Kong",    t:"Crypto Quant Trading",     l:"https://www.ambergroup.io/careers" },
  { n:"Keyrock",                            c:"Brussels · London · Singapore",                      co:"Belgium",      t:"Crypto Market Making",     l:"https://keyrock.eu/careers/" },
  { n:"Alameda Research (defunct)",         c:"Hong Kong · NYC",                                    co:"USA",          t:"Crypto Prop Trading",      l:"https://www.alameda-research.com" },
  { n:"Genesis Trading",                    c:"NYC · Singapore",                                    co:"USA",          t:"Crypto Brokerage / Trading",l:"https://genesistrading.com/careers/" },
  { n:"Galaxy Digital",                     c:"NYC · London · Hong Kong",                           co:"USA",          t:"Crypto Asset Management",  l:"https://www.galaxydigital.io/careers" },
  { n:"BitMEX",                             c:"Seychelles · Singapore · Hong Kong",                  co:"Seychelles",   t:"Crypto Exchange / Quant",  l:"https://www.bitmex.com/careers" },
  { n:"Deribit",                            c:"Panama · Amsterdam",                                  co:"Panama",       t:"Crypto Options Exchange",  l:"https://www.deribit.com/careers" },
  { n:"dYdX",                               c:"San Francisco · Remote",                              co:"USA",          t:"DeFi Exchange / Quant",    l:"https://www.dydx.exchange/careers" },
  { n:"Kraken",                             c:"San Francisco · London · Dublin",                    co:"USA",          t:"Crypto Exchange",          l:"https://www.kraken.com/en-us/careers" },
  { n:"Coinbase (Institutional Trading)",   c:"San Francisco · NYC · London",                       co:"USA",          t:"Crypto Exchange / Trading",l:"https://www.coinbase.com/careers" },
  { n:"Binance (Quant Research)",           c:"Remote · Singapore · Dubai",                         co:"Cayman Islands",t:"Crypto Exchange / Quant",  l:"https://www.binance.com/en/careers" },
  { n:"OKX (OKEx)",                         c:"Dubai · Singapore · Hong Kong",                      co:"Seychelles",   t:"Crypto Exchange / Quant",  l:"https://www.okx.com/careers" },
  { n:"Bybit",                              c:"Dubai · Singapore",                                   co:"UAE",          t:"Crypto Exchange",          l:"https://www.bybit.com/en-US/careers" },
  { n:"Paradigm (Crypto VC / Quant)",       c:"San Francisco",                                      co:"USA",          t:"Crypto Venture / Research",l:"https://paradigm.xyz/careers/" },

  // ═══ SYSTEMATIC & ALGO TRADING BOUTIQUES ═══
  { n:"Capital Fund Management (CFM)",      c:"Paris · NYC · London",                              co:"France",       t:"Quant Hedge Fund",         l:"https://www.cfm.fr/careers/" },
  { n:"Sabre88 (Systematic)",               c:"London",                                             co:"UK",           t:"Quant Hedge Fund",         l:"https://sabre88.com" },
  { n:"Pelion Capital",                     c:"London",                                             co:"UK",           t:"Systematic Macro",         l:"https://pelioncap.com" },
  { n:"Amplitude Capital",                  c:"Zug · London",                                       co:"Switzerland",  t:"Systematic Trading",       l:"https://amplitudecapital.com/careers/" },
  { n:"Fulcrum Asset Management",           c:"London",                                             co:"UK",           t:"Systematic Trading",       l:"https://www.fulcrumasset.com/careers/" },
  { n:"Mosaic Smart Data",                  c:"London",                                             co:"UK",           t:"Quant Analytics FinTech",  l:"https://mosaicsmartdata.com/careers/" },
  { n:"Florin Court Capital",               c:"London",                                             co:"UK",           t:"Quant Macro Fund",         l:"https://florincourt.com/careers" },
  { n:"LMR Partners",                       c:"London",                                             co:"UK",           t:"Systematic Macro",         l:"https://lmrpartners.com/careers" },
  { n:"Brevan Howard (Quant)",              c:"London · Jersey · Zug · NYC",                       co:"UK",           t:"Macro / Quant Fund",       l:"https://www.brevanhoward.com/careers" },
  { n:"Odey Asset Management",              c:"London",                                             co:"UK",           t:"Systematic Macro",         l:"https://odeyam.com/careers/" },
  { n:"Comac Capital",                      c:"London",                                             co:"UK",           t:"Global Macro Quant",       l:"https://comaccapital.com" },
  { n:"Fasanara Capital",                   c:"London",                                             co:"UK",           t:"Systematic / DeFi Fund",   l:"https://fasanara.com/careers/" },
  { n:"Autonomy Capital",                   c:"London · NYC",                                       co:"UK",           t:"Macro Quant Fund",         l:"https://autonomycap.com" },
  { n:"Marshall Wace",                      c:"London · NYC · Hong Kong",                           co:"UK",           t:"Quant / Systematic Fund",  l:"https://mwam.com/careers/" },
  { n:"Egerton Capital (Quant)",            c:"London",                                             co:"UK",           t:"Quant Long/Short Fund",    l:"https://egertonlondon.com" },
  { n:"Algebris Investments",               c:"London · Milan · Singapore",                         co:"UK",           t:"Quant / Credit Fund",      l:"https://www.algebris.com/careers" },
  { n:"Polar Capital (Quant)",              c:"London",                                             co:"UK",           t:"Quant Fund",               l:"https://www.polarcapital.co.uk/careers" },

  // ═══ ASIA-PACIFIC QUANT FIRMS ═══
  { n:"Tower Capital Asia",                 c:"Singapore · Hong Kong",                             co:"Singapore",    t:"Quant Prop Trading",       l:"https://towercap.asia/careers" },
  { n:"Greenwoods Asset Management",        c:"Shanghai · Hong Kong",                              co:"China",        t:"Quant Hedge Fund",         l:"https://greenwoodsam.com" },
  { n:"Quantitative Asset Management (QAM)",c:"Sydney",                                             co:"Australia",    t:"Quant Asset Management",   l:"https://qam.com.au/careers" },
  { n:"Macquarie Quantitative Strategy",    c:"Sydney · NYC",                                       co:"Australia",    t:"Quant Strategies",         l:"https://www.macquarie.com/au/en/careers.html" },
  { n:"Pacific Asset Management (Quant)",   c:"Singapore",                                          co:"Singapore",    t:"Quant Asset Management",   l:"https://www.pac-am.com/careers" },
  { n:"Black River Asset Management",       c:"Singapore · Minnetonka MN",                          co:"USA",          t:"Quant Commodity Fund",     l:"https://www.blackriverassetmanagement.com" },
  { n:"Taikang Asset Management (Quant)",   c:"Beijing · Shanghai",                                 co:"China",        t:"Quant Asset Management",   l:"https://www.taikangam.com/careers" },
  { n:"Ping An Asset Management (Quant)",   c:"Shenzhen · Shanghai",                               co:"China",        t:"Quant Asset Management",   l:"https://www.pa-am.com.cn/careers" },
  { n:"CITIC Securities (Quant Research)",  c:"Beijing · Shanghai · Hong Kong",                    co:"China",        t:"Investment Bank – Quant",  l:"https://www.citics.com/en/careers" },
  { n:"Guotai Junan (Quant)",               c:"Shanghai · Beijing",                                 co:"China",        t:"Investment Bank – Quant",  l:"https://www.gtja.com/careers" },
  { n:"Haitong Securities (Quant)",         c:"Shanghai · Hong Kong",                               co:"China",        t:"Investment Bank – Quant",  l:"https://www.htsc.com.cn" },
  { n:"China International Capital Corp (CICC Quant)",c:"Beijing · Hong Kong · NYC",               co:"China",        t:"Investment Bank – Quant",  l:"https://www.cicc.com/careers" },
  { n:"Bofa Hariken (Asia Quant)",          c:"Singapore · Tokyo",                                  co:"Japan",        t:"Quant Prop Trading",       l:"https://www.bankofamerica.com/careers/" },
  { n:"Daiwa Securities (Quant)",           c:"Tokyo · London · NYC",                               co:"Japan",        t:"Investment Bank – Quant",  l:"https://www.daiwa-grp.jp/en/careers" },
  { n:"SMBC Nikko (Quant)",                 c:"Tokyo · London · NYC",                               co:"Japan",        t:"Investment Bank – Quant",  l:"https://www.nikko.smbc.co.jp/en/careers" },
  { n:"Hana Financial (Quant Korea)",       c:"Seoul · NYC",                                        co:"South Korea",  t:"Investment Bank – Quant",  l:"https://www.hanafn.com/en/careers" },
  { n:"Samsung Asset Management (Quant)",   c:"Seoul · NYC · London",                               co:"South Korea",  t:"Quant Asset Management",   l:"https://www.samsungfund.com/eng/careers" },

  // ═══ QUANT RESEARCH & CONSULTING ═══
  { n:"Oliver Wyman (Quant Risk)",          c:"NYC · London · Singapore",                           co:"USA",          t:"Risk Consulting",          l:"https://www.oliverwyman.com/careers.html" },
  { n:"McKinsey (QuantumBlack)",            c:"London · NYC · Singapore",                           co:"UK",           t:"AI / Quant Consulting",    l:"https://www.mckinsey.com/quantumblack/careers" },
  { n:"Boston Consulting Group (BCG Gamma)",c:"Boston · London · NYC · Singapore",                 co:"USA",          t:"Data Science Consulting",  l:"https://careers.bcg.com/" },
  { n:"Accenture (Quant Analytics)",        c:"Dublin · NYC · London · Singapore",                  co:"Ireland",      t:"Analytics Consulting",     l:"https://www.accenture.com/us-en/careers" },
  { n:"Willis Towers Watson (Quant)",       c:"London · NYC · Dublin",                              co:"UK",           t:"Actuarial / Quant",        l:"https://careers.wtwco.com/" },
  { n:"Aon (Quant Analytics)",              c:"London · Chicago · NYC",                             co:"UK",           t:"Risk Analytics",           l:"https://aoncareers.com/" },
  { n:"Deloitte (Quant Risk)",              c:"London · NYC · Frankfurt · Singapore",               co:"USA",          t:"Risk Consulting",          l:"https://www2.deloitte.com/global/en/careers.html" },
  { n:"PwC (Quantitative Services)",        c:"London · NYC · Frankfurt",                           co:"UK",           t:"Risk Consulting",          l:"https://www.pwc.com/gx/en/careers.html" },
  { n:"EY (Financial Risk Quant)",          c:"London · NYC · Singapore · Frankfurt",               co:"UK",           t:"Risk Consulting",          l:"https://www.ey.com/en_gl/careers" },
  { n:"KPMG (Quant Risk)",                  c:"London · NYC · Frankfurt",                           co:"Netherlands",  t:"Risk Consulting",          l:"https://home.kpmg/xx/en/home/careers.html" },
  { n:"Numeris Analytics",                  c:"NYC · London",                                       co:"USA",          t:"Quant Analytics Boutique", l:"https://numerisanalytics.com" },
  { n:"Quantitative Brokers (QB)",          c:"NYC · London · Sydney",                              co:"USA",          t:"Algo Execution / Quant",   l:"https://www.quantitativebrokers.com/careers/" },
  { n:"Abel Noser Solutions",               c:"NYC",                                                co:"USA",          t:"Trading Analytics",        l:"https://abelnoser.com/careers" },
  { n:"ITG (Virtu ITG)",                    c:"NYC · London · Hong Kong",                           co:"USA",          t:"Quant Execution",          l:"https://www.virtu.com/careers/" },
  { n:"Pragma Securities",                  c:"NYC",                                                co:"USA",          t:"Algo Trading Technology",  l:"https://www.pragmasecurities.com/careers/" },

  // ═══ TECHNOLOGY FIRMS – QUANT/TRADING ADJACENT ═══
  { n:"Google DeepMind (Finance AI)",       c:"London · Mountain View · NYC",                      co:"USA",          t:"AI / ML Research",         l:"https://deepmind.com/careers" },
  { n:"Microsoft Research (Finance)",       c:"Redmond WA · NYC · London",                         co:"USA",          t:"AI Research / Finance",    l:"https://careers.microsoft.com/" },
  { n:"Amazon (AWS Financial Services)",    c:"Seattle · NYC · London",                             co:"USA",          t:"Cloud / Financial AI",     l:"https://www.amazon.jobs/" },
  { n:"Meta (Financial ML)",                c:"Menlo Park · NYC · London",                          co:"USA",          t:"ML Research",              l:"https://www.metacareers.com/" },
  { n:"Apple (Financial Services Tech)",    c:"Cupertino CA · NYC · London",                        co:"USA",          t:"FinTech",                  l:"https://www.apple.com/careers/" },
  { n:"Stripe (Financial Infrastructure)",  c:"San Francisco · Dublin · London · Singapore",        co:"USA",          t:"Payments FinTech",         l:"https://stripe.com/jobs" },
  { n:"Plaid",                              c:"San Francisco · Salt Lake City",                     co:"USA",          t:"Open Banking FinTech",     l:"https://plaid.com/careers/" },
  { n:"Affirm (Quant Risk)",                c:"San Francisco · NYC",                                co:"USA",          t:"FinTech / Risk",           l:"https://www.affirm.com/careers" },
  { n:"Robinhood (Quant Finance)",          c:"Menlo Park · NYC",                                   co:"USA",          t:"Retail Brokerage FinTech", l:"https://careers.robinhood.com/" },
  { n:"Interactive Brokers (Quant)",        c:"Greenwich CT · London · Singapore · Hong Kong",     co:"USA",          t:"Electronic Brokerage",     l:"https://www.interactivebrokers.com/en/index.php?f=careers" },
  { n:"Tradeweb",                           c:"NYC · London · Singapore · Tokyo",                  co:"USA",          t:"Electronic Bond Trading",  l:"https://www.tradeweb.com/careers/" },
  { n:"MarketAxess",                        c:"NYC · London · Singapore",                           co:"USA",          t:"Electronic Bond Trading",  l:"https://www.marketaxess.com/careers" },
  { n:"FINRA (Financial Industry Reg.)",    c:"Washington DC · NYC",                                co:"USA",          t:"Market Regulation / Quant",l:"https://www.finra.org/about/careers" },
  { n:"Federal Reserve Bank (Quant Econ)", c:"NYC · Chicago · Washington DC",                      co:"USA",          t:"Central Bank / Quant Econ",l:"https://www.federalreserve.gov/careers.htm" },
  { n:"Bank for International Settlements (BIS)",c:"Basel",                                         co:"Switzerland",  t:"Central Bank Research",   l:"https://www.bis.org/careers.htm" },
  { n:"European Central Bank (Quant)",      c:"Frankfurt",                                          co:"Germany",      t:"Central Bank / Risk",      l:"https://www.ecb.europa.eu/careers/" },
  { n:"IMF (Quantitative Research)",        c:"Washington DC",                                      co:"USA",          t:"Macro / Quant Economics",  l:"https://www.imf.org/en/Careers" },
  { n:"World Bank (Quant Finance)",         c:"Washington DC",                                      co:"USA",          t:"Development Finance",      l:"https://www.worldbank.org/en/about/careers" },

  // ═══ INDIA-BASED QUANT FIRMS ═══
  { n:"Quadeye Securities",                 c:"Gurugram",                                           co:"India",        t:"HFT / Prop Trading",       l:"https://quadeye.com/careers" },
  { n:"Graviton Research Capital",          c:"Mumbai · Gurugram",                                  co:"India",        t:"HFT / Quant Trading",      l:"https://gravitonresearch.com/careers" },
  { n:"Estee Advisors",                     c:"Mumbai",                                             co:"India",        t:"HFT / Algorithmic Trading",l:"https://esteeadvisors.com/careers" },
  { n:"AlphaGrep Securities",               c:"Mumbai",                                             co:"India",        t:"HFT / Prop Trading",       l:"https://alphagrep.com/careers" },
  { n:"Dolat Capital (Quant)",              c:"Mumbai",                                             co:"India",        t:"Quant Prop Trading",       l:"https://www.dolatgroup.com/careers" },
  { n:"iRage Capital",                      c:"Mumbai",                                             co:"India",        t:"HFT / Options Market Making",l:"https://iragecapital.com/careers" },
  { n:"Edelweiss (Quant)",                  c:"Mumbai",                                             co:"India",        t:"Investment Bank – Quant",  l:"https://www.edelweissfin.com/careers" },
  { n:"Kotak Securities (Algo Trading)",    c:"Mumbai",                                             co:"India",        t:"Algorithmic Trading",      l:"https://www.kotaksecurities.com/careers" },
  { n:"HDFC Securities (Quant)",            c:"Mumbai",                                             co:"India",        t:"Quant Analytics",          l:"https://www.hdfcsec.com/careers" },
  { n:"Tower Capital India",                c:"Mumbai · Hyderabad",                                 co:"India",        t:"Quant Prop Trading",       l:"https://www.towercapital.in/careers" },
  { n:"Plutus Research",                    c:"Hyderabad",                                          co:"India",        t:"Quant Research / HFT",     l:"https://plutusresearch.in/careers" },
  { n:"Axis Capital (Quant)",               c:"Mumbai",                                             co:"India",        t:"Investment Bank – Quant",  l:"https://www.axiscap.in/careers" },

  // ═══ MIDDLE EAST & AFRICA QUANT ═══
  { n:"Mubadala Investment Company",        c:"Abu Dhabi · NYC · London · Singapore",               co:"UAE",          t:"Sovereign Wealth / Quant", l:"https://www.mubadala.com/en/careers" },
  { n:"Abu Dhabi Investment Authority (ADIA)",c:"Abu Dhabi",                                        co:"UAE",          t:"Sovereign Wealth Fund",    l:"https://www.adia.ae/careers" },
  { n:"GIC (Singapore Sovereign Fund)",     c:"Singapore · NYC · London · São Paulo",              co:"Singapore",    t:"Sovereign Wealth / Quant", l:"https://www.gic.com.sg/careers/" },
  { n:"Temasek (Investment Quant)",         c:"Singapore · NYC · London",                           co:"Singapore",    t:"Sovereign Wealth / Quant", l:"https://www.temasek.com.sg/en/people/careers" },
  { n:"Qatar Investment Authority (QIA)",   c:"Doha",                                               co:"Qatar",        t:"Sovereign Wealth Fund",    l:"https://www.qia.qa/careers" },
  { n:"Kuwait Investment Authority (KIA)",  c:"Kuwait City · London",                               co:"Kuwait",       t:"Sovereign Wealth Fund",    l:"https://www.kia.gov.kw" },
  { n:"Sanlam Investments (Quant)",         c:"Cape Town · Johannesburg",                           co:"South Africa", t:"Quant Asset Management",   l:"https://www.sanlaminvestments.com/careers" },
  { n:"Investec Asset Management (Quant)",  c:"Cape Town · London · NYC",                           co:"South Africa", t:"Quant Asset Management",   l:"https://www.ninety-one.com/en_za/about/careers" },

  // ═══ LATIN AMERICA QUANT ═══
  { n:"XP Investimentos (Quant)",           c:"São Paulo · Rio de Janeiro",                         co:"Brazil",       t:"Quant Investment Platform",l:"https://careers.xpi.com.br/" },
  { n:"BTG Pactual (Quant Trading)",        c:"São Paulo · NYC · London",                           co:"Brazil",       t:"Investment Bank – Quant",  l:"https://www.btgpactual.com/careers" },
  { n:"Itaú BBA (Quant Research)",          c:"São Paulo · NYC · London",                           co:"Brazil",       t:"Investment Bank – Quant",  l:"https://www.itaubba.com/en/careers" },
  { n:"Inter & Co (Fintech Quant)",         c:"Belo Horizonte · Miami",                             co:"Brazil",       t:"Quant FinTech",            l:"https://inter.co/careers" },

  // ═══ EUROPEAN QUANT BOUTIQUES ═══
  { n:"Man AHL",                            c:"London · Oxford",                                    co:"UK",           t:"Quant Hedge Fund",         l:"https://www.man.com/ahl/careers" },
  { n:"Invast Global",                      c:"Sydney · Tokyo",                                     co:"Australia",    t:"Algo / Multi-Asset Broker",l:"https://www.invast.com.au/careers" },
  { n:"Kepler Cheuvreux (Quant)",           c:"Paris · Frankfurt · Zurich · London",               co:"France",       t:"Quant Research Broker",    l:"https://www.keplercheuvreux.com/careers" },
  { n:"Exane BNP (Quant Research)",         c:"Paris · London · NYC",                               co:"France",       t:"Quant Research Broker",    l:"https://www.exane.com/careers" },
  { n:"Oddo BHF (Quant)",                   c:"Paris · Frankfurt · Geneva",                         co:"France",       t:"Quant Asset Management",   l:"https://www.oddo-bhf.com/careers" },
  { n:"Amundi (Quant Equity)",              c:"Paris · London · Milan · Luxembourg",                co:"France",       t:"Quant Asset Management",   l:"https://about.amundi.com/Expertise/Careers" },
  { n:"Lyxor Asset Management (Quant)",     c:"Paris · London",                                     co:"France",       t:"Quant / ETF Asset Mgmt",   l:"https://www.lyxor.com/careers" },
  { n:"Generali Investments (Quant)",       c:"Trieste · Milan · Paris",                            co:"Italy",        t:"Quant Asset Management",   l:"https://www.generali-investments.com/careers" },
  { n:"Axa Investment Managers (Quant)",    c:"Paris · London · Hong Kong",                         co:"France",       t:"Quant Asset Management",   l:"https://www.axa-im.com/about-us/careers" },
  { n:"NN Investment Partners (Quant)",     c:"The Hague · London · Singapore",                     co:"Netherlands",  t:"Quant Asset Management",   l:"https://www.nnip.com/en-INT/professional/about-us/careers" },
  { n:"Union Investment (Quant)",           c:"Frankfurt",                                           co:"Germany",      t:"Quant Asset Management",   l:"https://www.union-investment.de/startseite/karriere.html" },
  { n:"DWS Group (Quant Strategies)",       c:"Frankfurt · NYC · London · Singapore",               co:"Germany",      t:"Quant Asset Management",   l:"https://www.dws.com/careers/" },
  { n:"Allianz Global Investors (Quant)",   c:"Munich · Frankfurt · London · Hong Kong",            co:"Germany",      t:"Quant Asset Management",   l:"https://www.allianzgi.com/en/careers" },
  { n:"MEAG Asset Management (Quant)",      c:"Munich · NYC · Singapore",                           co:"Germany",      t:"Quant Asset Management",   l:"https://www.meag.com/de/karriere/" },
  { n:"Zurich Investment Management",       c:"Zurich · NYC · London",                              co:"Switzerland",  t:"Quant Asset Management",   l:"https://www.zurich.com/en/careers" },
  { n:"Vontobel Asset Management (Quant)",  c:"Zurich · London · NYC",                              co:"Switzerland",  t:"Quant Asset Management",   l:"https://www.vontobel.com/en/about-vontobel/careers/" },
  { n:"Julius Baer (Quant)",               c:"Zurich · London · Singapore",                        co:"Switzerland",  t:"Wealth Mgmt / Quant",      l:"https://www.juliusbaer.com/global/en/careers/" },
  { n:"Lombard Odier (Quant)",              c:"Geneva · London · Singapore",                        co:"Switzerland",  t:"Wealth Mgmt / Quant",      l:"https://www.lombardodier.com/careers" },
  { n:"Nordea Asset Management (Quant)",    c:"Helsinki · Stockholm · Copenhagen",                  co:"Finland",      t:"Quant Asset Management",   l:"https://www.nordea.com/en/careers/" },
  { n:"SEB (Quant Research)",              c:"Stockholm · London · Frankfurt",                     co:"Sweden",       t:"Investment Bank – Quant",  l:"https://sebgroup.com/careers" },
  { n:"Handelsbanken Capital Markets",      c:"Stockholm · London · NYC",                           co:"Sweden",       t:"Quant Research",           l:"https://www.handelsbanken.com/en/investors-and-shareholders/careers" },
  { n:"DNB Asset Management (Quant)",       c:"Oslo · Stockholm · London",                          co:"Norway",       t:"Quant Asset Management",   l:"https://www.dnb.no/en/about-us/careers/" },

]
// ─ end of QUANT_FIRMS ─



// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/prereqs.js
// PREREQS: maps course id → array of course ids that should be done first
// To add: PREREQS["new_id"] = ["dep_id1", "dep_id2"]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PREREQS = {
  // Mathematics chain
  "m1":  ["m0"],                          // Multivariable Calculus → Single Variable
  "m2":  ["m0", "m1"],                    // Differential Equations → Calc I+II
  "m4":  ["m0", "m1"],                    // Linear Algebra → Calc I+II
  "m6":  ["m3", "m4"],                    // Stochastic Processes → Prob + LinAlg
  "m8":  ["m3", "m6"],                    // Theory of Probability → Prob + Stoch
  "m9":  ["m4"],                          // Matrix Methods → Linear Algebra
  "m13": ["m3", "m6"],                    // Stochastic Calculus → Prob + Stoch
  "m26": ["m3"],                          // Statistics → Probability
  // CS chain
  "c10": ["p1", "p2"],                    // Advanced Algorithms → Intro + Basic Algos
  "c16": ["c8"],                          // Distributed Systems → OS
  "c15": ["p2", "p5"],                    // Performance Engineering → Algos + C++
  // Programming chain
  "p1":  ["p2"],                          // Design & Analysis of Algos → Intro Algos
  "p5":  ["p6"],                          // C++ Advanced → Python first
  "p14": ["p5"],                          // Core C++ HFT → C++ basics
  "p15": ["p14"],                         // Low Latency → Core C++ HFT
  "p17": ["p15"],                         // Building Trading Systems → Low Latency
  // ML chain
  "ml5": ["m3", "m4"],                    // ML (Andrew Ng) → Prob + LinAlg
  "ml4": ["ml5"],                         // AI Principles → ML basics
  "ml1": ["ml5", "p18"],                  // Deep Learning → ML + PyTorch
  "ml6": ["ml5"],                         // RL → ML basics
  "ml11":["ml1"],                         // NLP → Deep Learning
  "ml12":["ml1"],                         // CNNs → Deep Learning
  // Finance chain
  "f0":  ["m3"],                          // Financial Theory → Probability
  "f1":  ["f0"],                          // Financial Markets → Financial Theory
  "f2":  [],                              // Game Theory — standalone
  "f7":  ["f1", "m3"],                    // Quant Investment Mgmt → Markets + Prob
  "f9":  ["f1"],                          // Quant Modelling → Financial Markets
  "f13": ["f1", "m3"],                    // Financial Engineering → Markets + Prob
  "f18": ["m2", "m3", "f1"],              // Math with Finance Apps → Calc+Prob+Finance
  "f22": ["f7", "ml5"],                   // Algo Trading & Portfolio Mgmt → both
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/internships.js
// INTERNSHIPS: quant internship programs with open cycles
// Fields: id, company, role, location, deadline, link, type, status, notes
// status: "open" | "tba" | "closed"
// To add: append an object following this schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const INTERNSHIPS = [
  // ═══ SUMMER 2026 QUANT / TRADING / RESEARCH ═══
  { id:"i1",  company:"Jane Street",           role:"Quantitative Trader Intern",          location:"NYC / London / Hong Kong",       deadline:"2026-10-15", link:"https://www.janestreet.com/join-jane-street/internship/",      type:"Trading",    status:"tba",  notes:"Apply Aug–Oct for summer 2027. Hiring typically opens in autumn." },
  { id:"i2",  company:"Citadel",               role:"Quantitative Research Intern",        location:"Chicago / NYC / London",          deadline:"2026-09-01", link:"https://www.citadel.com/careers/open-opportunities/students/", type:"Quant",      status:"tba",  notes:"Separate tracks: QR, Trading, SWE. Opens Sept for summer 2027." },
  { id:"i3",  company:"Citadel Securities",    role:"Quant Research / Trading Intern",     location:"Chicago / NYC / Dublin",          deadline:"2026-09-01", link:"https://www.citadelsecurities.com/careers/open-opportunities/students/", type:"Trading", status:"tba", notes:"Application window typically Sept–Oct." },
  { id:"i4",  company:"Two Sigma",             role:"Quantitative Research Intern",        location:"NYC",                             deadline:"2026-10-01", link:"https://www.twosigma.com/careers/",                           type:"Quant",      status:"tba",  notes:"QR intern program — PhD/Masters preferred. Opens Oct." },
  { id:"i5",  company:"D.E. Shaw",             role:"Quantitative Analyst / Trader Intern",location:"NYC",                             deadline:"2026-09-15", link:"https://www.deshaw.com/careers/open-positions",              type:"Quant",      status:"tba",  notes:"Multiple tracks. Discovery programmes run year-round." },
  { id:"i6",  company:"IMC Trading",           role:"Trader / Quant Developer Intern",     location:"Amsterdam / Chicago / Sydney",    deadline:"2026-10-01", link:"https://imc.com/eu/career-opportunities/",                   type:"Trading",    status:"tba",  notes:"IMC Prosperity winners are fast-tracked." },
  { id:"i7",  company:"Optiver",               role:"Trader / Quant Researcher Intern",    location:"Amsterdam / Sydney / Singapore",  deadline:"2026-10-01", link:"https://optiver.com/working-at-optiver/career-opportunities/",type:"Trading",    status:"tba",  notes:"FutureFocus events are a direct pipeline to internships." },
  { id:"i8",  company:"Hudson River Trading",  role:"Algorithm Developer Intern",          location:"NYC / London / Singapore",        deadline:"2026-10-15", link:"https://www.hudsonrivertrading.com/careers/",                 type:"SWE/Quant",  status:"tba",  notes:"Focus on low-latency C++ and algo development." },
  { id:"i9",  company:"Susquehanna (SIG)",     role:"Quantitative Trader Intern",          location:"Bala Cynwyd PA / Dublin",         deadline:"2026-10-01", link:"https://careers.sig.com/",                                   type:"Trading",    status:"tba",  notes:"Discovery Days are prerequisite recommended." },
  { id:"i10", company:"Jump Trading",          role:"Quantitative Research Intern",        location:"Chicago / NYC / London",          deadline:"2026-11-01", link:"https://www.jumptrading.com/careers/",                        type:"Quant",      status:"tba",  notes:"Strong emphasis on maths olympiad background." },
  { id:"i11", company:"Akuna Capital",         role:"Quantitative Trading Intern",         location:"Chicago / Sydney / Singapore",    deadline:"2026-09-01", link:"https://akunacapital.com/careers",                            type:"Trading",    status:"tba",  notes:"Options-focused. Sneak Peek Week is direct pipeline." },
  { id:"i12", company:"DRW / Cumberland",      role:"Quantitative Trading Intern",         location:"Chicago / London",                deadline:"2026-10-01", link:"https://drw.com/careers/",                                   type:"Trading",    status:"tba",  notes:"Also hires for crypto (Cumberland) and systematic research." },
  { id:"i13", company:"Virtu Financial",       role:"Quantitative Research Intern",        location:"NYC",                             deadline:"2026-10-01", link:"https://www.virtu.com/careers/",                             type:"Quant",      status:"tba",  notes:"Women's Winternship runs January each year." },
  { id:"i14", company:"Five Rings Capital",    role:"Quantitative Trading Intern",         location:"NYC",                             deadline:"2026-09-01", link:"https://fiverings.com/jobs/",                                 type:"Trading",    status:"tba",  notes:"Very small team — highly selective, strong maths required." },
  { id:"i15", company:"Bridgewater",           role:"Investment Logic Intern",             location:"Westport CT",                     deadline:"2026-11-01", link:"https://www.bridgewater.com/careers",                        type:"Macro/Quant",status:"tba",  notes:"Rising Fellows / immersion programmes run alongside internships." },
  { id:"i16", company:"AQR Capital",           role:"Quantitative Research Intern",        location:"Greenwich CT / London",           deadline:"2026-10-15", link:"https://www.aqr.com/About-Us/Careers",                       type:"Quant",      status:"tba",  notes:"Strong factor-model and academic research culture." },
  { id:"i17", company:"Point72",               role:"Quantitative Analyst Intern",         location:"Stamford CT / NYC / London",      deadline:"2026-10-01", link:"https://point72.com/careers/",                               type:"Quant",      status:"tba",  notes:"Cubist Systematic Strategies intern track available." },
  { id:"i18", company:"WorldQuant",            role:"Quantitative Researcher Intern",      location:"NYC / Singapore / Warsaw",        deadline:"2026-11-01", link:"https://www.worldquant.com/career-listing/",                  type:"Quant",      status:"tba",  notes:"BRAIN IQC competition is a direct pipeline." },
  { id:"i19", company:"Goldman Sachs",         role:"Quantitative Strategies Intern",      location:"NYC / London / Hong Kong",        deadline:"2026-10-01", link:"https://www.goldmansachs.com/careers/",                      type:"Bank Quant", status:"tba",  notes:"Strats division. Apply through main campus recruiting portal." },
  { id:"i20", company:"Morgan Stanley",        role:"Quantitative Finance Intern",         location:"NYC / London",                    deadline:"2026-10-01", link:"https://www.morganstanley.com/people-opportunities/students-graduates", type:"Bank Quant", status:"tba", notes:"MSET and QF intern streams. Strong coding required." },
  { id:"i21", company:"J.P. Morgan",           role:"Quantitative Analytics Intern",       location:"NYC / London / Singapore",        deadline:"2026-10-01", link:"https://careers.jpmorgan.com/global/en/students",             type:"Bank Quant", status:"tba",  notes:"Separate QA and Securities intern tracks." },
  { id:"i22", company:"Qube Research & Tech",  role:"Quantitative Researcher Intern",      location:"London / Hong Kong / Paris",      deadline:"2026-11-01", link:"https://www.qube-rt.com/careers/",                           type:"Quant",      status:"tba",  notes:"Very fast-growing firm. Strong stats + ML background required." },
  { id:"i23", company:"Squarepoint Capital",   role:"Quantitative Researcher Intern",      location:"London / NYC / Singapore",        deadline:"2026-11-01", link:"https://www.squarepoint-capital.com/careers",                 type:"Quant",      status:"tba",  notes:"Academic research-heavy culture. PhD pipeline." },
  { id:"i24", company:"Man AHL",               role:"Quant Researcher Intern",             location:"London / Oxford",                 deadline:"2026-11-01", link:"https://www.man.com/ahl/careers",                            type:"Quant",      status:"tba",  notes:"Part of Man Group. Time-series and ML focus." },
  { id:"i25", company:"Schonfeld",             role:"Quantitative Research Intern",        location:"NYC / London",                    deadline:"2026-10-15", link:"https://www.schonfeld.com/careers/",                         type:"Quant",      status:"tba",  notes:"Discretionary and systematic tracks available." },
  // ═══ SWE / QUANT TECH INTERNSHIPS ═══
  { id:"i26", company:"Jane Street",           role:"Software Engineer Intern (JSIP)",     location:"NYC",                             deadline:"2026-02-08", link:"https://www.janestreet.com/join-jane-street/programs-and-events/jsip/", type:"SWE", status:"open", notes:"JSIP is a summer SWE immersion. Deadline Feb 8 2026." },
  { id:"i27", company:"Citadel",               role:"Software Engineer Intern",            location:"Chicago / NYC",                   deadline:"2026-09-01", link:"https://www.citadel.com/careers/open-opportunities/students/", type:"SWE", status:"tba",  notes:"Separate SWE intern track from QR/trading." },
  { id:"i28", company:"Two Sigma",             role:"Software Engineering Intern",         location:"NYC",                             deadline:"2026-10-01", link:"https://www.twosigma.com/careers/",                           type:"SWE",        status:"tba",  notes:"SWE intern focuses on trading infrastructure and data systems." },
  { id:"i29", company:"Bloomberg",             role:"Financial Software Developer Intern", location:"NYC / London",                    deadline:"2026-10-15", link:"https://careers.bloomberg.com/",                             type:"SWE/FinTech",status:"tba",  notes:"Works on core Terminal, data, and analytics infrastructure." },
  { id:"i30", company:"IMC Trading",           role:"Software Engineer Intern",            location:"Amsterdam / Chicago",             deadline:"2026-10-01", link:"https://imc.com/eu/career-opportunities/",                   type:"SWE",        status:"tba",  notes:"Low-latency C++ systems focus." },
]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/flashcards.js
// FLASHCARD_DECKS: spaced-repetition flashcards for quant concepts
// Each deck: { id, name, color, cards: [{q, a}] }
// To add a card: append { q, a } to the relevant deck's cards array
// To add a deck: append a new deck object
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/jobs.js
// JOBS: Full-time quant roles — QR, QT, QD, SWE at quant firms
// Fields: id, company, role, type, location, link, status, notes, posted
// status: "open" | "rolling" | "closed"
// type: "QR" | "QT" | "QD" | "SWE" | "Risk" | "Other"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const JOBS = [
  { id:"j1",  company:"Jane Street",       role:"Quantitative Researcher",        type:"QR",  location:"New York / London",   status:"rolling", link:"https://www.janestreet.com/join-jane-street/open-roles/", notes:"Core research role — probability, maths puzzles", posted:"Rolling" },
  { id:"j2",  company:"Jane Street",       role:"Quantitative Trader",            type:"QT",  location:"New York / London / HK",status:"rolling",link:"https://www.janestreet.com/join-jane-street/open-roles/", notes:"Trading & research combined", posted:"Rolling" },
  { id:"j3",  company:"Citadel",           role:"Quantitative Researcher",        type:"QR",  location:"Chicago / New York",  status:"open",    link:"https://www.citadel.com/careers/", notes:"Markets, Equities, Fixed Income desks", posted:"2026-01" },
  { id:"j4",  company:"Citadel Securities","role":"Quantitative Developer",       type:"QD",  location:"Chicago / London",    status:"open",    link:"https://www.citadelsecurities.com/careers/", notes:"C++ heavy, low-latency focus", posted:"2026-01" },
  { id:"j5",  company:"Two Sigma",         role:"Quantitative Research Associate",type:"QR",  location:"New York",            status:"open",    link:"https://www.twosigma.com/careers/", notes:"Statistical modelling & ML", posted:"2026-02" },
  { id:"j6",  company:"Two Sigma",         role:"Quantitative Software Engineer", type:"SWE", location:"New York / Houston",  status:"open",    link:"https://www.twosigma.com/careers/", notes:"Python/C++, distributed systems", posted:"2026-02" },
  { id:"j7",  company:"D.E. Shaw",         role:"Quantitative Analyst",           type:"QR",  location:"New York",            status:"rolling", link:"https://www.deshaw.com/careers/", notes:"Discretionary + systematic", posted:"Rolling" },
  { id:"j8",  company:"Renaissance Technologies","role":"Research Analyst",       type:"QR",  location:"New York",            status:"rolling", link:"https://careers.rentec.com/", notes:"PhD preferred, very selective", posted:"Rolling" },
  { id:"j9",  company:"Virtu Financial",   role:"Quantitative Researcher",        type:"QR",  location:"New York",            status:"open",    link:"https://www.virtu.com/careers/", notes:"Market making, execution research", posted:"2026-01" },
  { id:"j10", company:"Optiver",           role:"Quantitative Researcher",        type:"QR",  location:"Amsterdam / Chicago", status:"open",    link:"https://optiver.com/working-at-optiver/career-opportunities/", notes:"Options & vol focus", posted:"2026-02" },
  { id:"j11", company:"Optiver",           role:"Software Engineer (Trading)",    type:"SWE", location:"Amsterdam / Chicago / Sydney",status:"open",link:"https://optiver.com/working-at-optiver/career-opportunities/", notes:"Low-latency C++", posted:"2026-02" },
  { id:"j12", company:"IMC Trading",       role:"Quantitative Researcher",        type:"QR",  location:"Amsterdam / Chicago", status:"open",    link:"https://careers.imc.com/", notes:"Options market making", posted:"2026-01" },
  { id:"j13", company:"Jump Trading",      role:"Quantitative Researcher",        type:"QR",  location:"Chicago / London",    status:"rolling", link:"https://www.jumptrading.com/careers/", notes:"Very competitive, PhD focus", posted:"Rolling" },
  { id:"j14", company:"SIG",               role:"Quantitative Trader",            type:"QT",  location:"Philadelphia",        status:"rolling", link:"https://sig.com/open-positions/", notes:"Options trading, training programme", posted:"Rolling" },
  { id:"j15", company:"Hudson River Trading","role":"Algorithm Developer",        type:"QD",  location:"New York",            status:"open",    link:"https://www.hudsonrivertrading.com/careers/", notes:"C++/Python, cross-discipline", posted:"2026-01" },
  { id:"j16", company:"Millennium Management","role":"Quantitative Researcher",   type:"QR",  location:"New York / London",   status:"rolling", link:"https://www.mlp.com/careers/", notes:"Multi-strat pod structure", posted:"Rolling" },
  { id:"j17", company:"AQR Capital",       role:"Quantitative Research Associate",type:"QR",  location:"Greenwich / London",  status:"open",    link:"https://careers.aqr.com/", notes:"Factor investing & alternatives", posted:"2026-02" },
  { id:"j18", company:"Man Group",         role:"Quantitative Researcher",        type:"QR",  location:"London",              status:"open",    link:"https://www.man.com/careers", notes:"Man AHL/Numeric systematic", posted:"2026-01" },
  { id:"j19", company:"Squarepoint Capital","role":"Quantitative Developer",      type:"QD",  location:"London / New York",   status:"rolling", link:"https://www.squarepoint-capital.com/careers", notes:"ML & systems dev", posted:"Rolling" },
  { id:"j20", company:"Cubist Systematic", role:"Quantitative Researcher",        type:"QR",  location:"New York",            status:"open",    link:"https://point72.com/cubist/", notes:"Point72's systematic arm", posted:"2026-01" },
]

const FLASHCARD_DECKS = [
  {
    id: "prob", name: "Probability & Statistics", color: "#C17F3A", cards: [
      { q: "What is the Central Limit Theorem?",                                    a: "The sum (or average) of n i.i.d. random variables with finite mean μ and variance σ² converges in distribution to N(μ, σ²/n) as n→∞, regardless of the underlying distribution." },
      { q: "Define a martingale.",                                                   a: "A stochastic process {Xₜ} is a martingale if E[Xₜ₊₁ | X₁,...,Xₜ] = Xₜ. Future expected value equals current value — no predictable drift." },
      { q: "What is Bayes' Theorem?",                                               a: "P(A|B) = P(B|A)·P(A) / P(B). Updates prior belief P(A) with likelihood P(B|A) to get posterior P(A|B)." },
      { q: "What is the Law of Large Numbers?",                                     a: "As n→∞, the sample mean X̄ₙ converges (in probability or almost surely) to the true mean μ." },
      { q: "What is the difference between Type I and Type II errors?",             a: "Type I (α): rejecting a true null (false positive). Type II (β): failing to reject a false null (false negative). Power = 1 − β." },
      { q: "Define variance and standard deviation.",                               a: "Var(X) = E[(X−μ)²] = E[X²] − μ². Standard deviation σ = √Var(X). Measures spread around the mean." },
      { q: "What is covariance and correlation?",                                   a: "Cov(X,Y) = E[(X−μₓ)(Y−μᵧ)]. Correlation ρ = Cov(X,Y)/(σₓσᵧ) ∈ [−1, 1]. Normalised measure of linear dependence." },
      { q: "What is a p-value?",                                                    a: "Probability of observing data at least as extreme as the actual data, assuming H₀ is true. Small p-value → evidence against H₀." },
      { q: "What is Jensen's inequality?",                                          a: "For a convex function f: E[f(X)] ≥ f(E[X]). For concave: E[f(X)] ≤ f(E[X]). Key in options pricing and risk." },
      { q: "What is the moment generating function (MGF)?",                         a: "M(t) = E[eᵗˣ]. If it exists near t=0, all moments can be recovered: E[Xⁿ] = Mⁿ(0). Uniquely identifies distributions." },
    ]
  },
  {
    id: "fin", name: "Finance & Derivatives", color: "#0ea5e9", cards: [
      { q: "State the Black-Scholes formula for a European call.",                  a: "C = S·N(d₁) − K·e^(−rT)·N(d₂), where d₁ = [ln(S/K)+(r+σ²/2)T]/(σ√T), d₂ = d₁ − σ√T. N is the standard normal CDF." },
      { q: "What are the Greeks? Define Delta and Gamma.",                          a: "Delta (Δ) = ∂C/∂S — sensitivity to spot price. Gamma (Γ) = ∂²C/∂S² — rate of change of Delta. Also: Theta (time decay), Vega (vol sensitivity), Rho (rate sensitivity)." },
      { q: "What is put-call parity?",                                              a: "C − P = S − K·e^(−rT). Holds for European options on non-dividend-paying stocks. Violation implies arbitrage." },
      { q: "What is the Sharpe Ratio?",                                             a: "SR = (Rₚ − Rₓ) / σₚ. Risk-adjusted return: excess return per unit of total volatility. Higher is better." },
      { q: "What is the Information Ratio?",                                        a: "IR = (Rₚ − Rᵦ) / TE, where TE = tracking error. Measures consistency of alpha generation relative to a benchmark." },
      { q: "Define Value at Risk (VaR).",                                           a: "VaR(α) = the loss that will not be exceeded with probability α over a given horizon. E.g., 95% 1-day VaR = loss exceeded only 5% of days." },
      { q: "What is the Efficient Market Hypothesis (EMH)?",                        a: "Prices fully reflect all available information. Weak: past prices. Semi-strong: all public info. Strong: all info including insider. Most quant strategies exploit weak-form deviations." },
      { q: "What is duration in fixed income?",                                     a: "Macaulay duration = weighted average time to cash flows. Modified duration ≈ −(dP/P)/(dr): % price change per 1% rate change. Convexity captures the curvature." },
      { q: "What is the CAPM?",                                                     a: "E[Rᵢ] = Rₓ + βᵢ(E[Rₘ] − Rₓ). Expected return = risk-free rate + beta × market risk premium. Beta = Cov(Rᵢ, Rₘ) / Var(Rₘ)." },
      { q: "What is the Fama-French 3-factor model?",                               a: "Rᵢ − Rₓ = α + β·MKT + s·SMB + h·HML + ε. Adds Small-Minus-Big (size) and High-Minus-Low (value) factors to CAPM." },
    ]
  },
  {
    id: "ml", name: "ML & Quant Methods", color: "#ec4899", cards: [
      { q: "What is overfitting and how do you combat it?",                         a: "Model fits noise in training data and fails to generalise. Combat with: regularisation (L1/L2), cross-validation, dropout, early stopping, more data." },
      { q: "Define bias-variance trade-off.",                                       a: "MSE = Bias² + Variance + Noise. High bias = underfitting (model too simple). High variance = overfitting (model too complex). Goal: minimise both." },
      { q: "What is gradient descent?",                                             a: "Iteratively updates parameters θ ← θ − η·∇L(θ) to minimise loss L. η is the learning rate. Stochastic GD uses mini-batches for efficiency." },
      { q: "What is a random forest?",                                              a: "Ensemble of decision trees trained on bootstrap samples with random feature subsets at each split. Final prediction: majority vote (classification) or average (regression). Reduces variance." },
      { q: "Explain the difference between L1 and L2 regularisation.",             a: "L1 (Lasso): penalty = λΣ|wᵢ|, encourages sparsity (feature selection). L2 (Ridge): penalty = λΣwᵢ², shrinks all weights, no sparsity. Elastic net combines both." },
      { q: "What is a confusion matrix?",                                           a: "2×2 table: TP, TN, FP, FN. Derived metrics: Precision = TP/(TP+FP), Recall = TP/(TP+FN), F1 = 2·P·R/(P+R), Accuracy = (TP+TN)/Total." },
      { q: "What is walk-forward validation in finance?",                           a: "Trains on expanding window of past data and tests on next period. Prevents look-ahead bias. In-sample (IS) performance ≫ out-of-sample (OOS) signals overfitting." },
      { q: "What is PCA?",                                                          a: "Principal Component Analysis: orthogonal linear transformation that maximises variance along successive axes. Reduces dimensionality. PCs are eigenvectors of the covariance matrix." },
      { q: "What is the Kelly Criterion?",                                          a: "Optimal bet fraction f* = (bp − q) / b, where b = odds, p = win probability, q = 1−p. Maximises log wealth in the long run. Often halved in practice (half-Kelly)." },
      { q: "What is alpha decay?",                                                  a: "The reduction in an alpha signal's predictive power over time, as more participants discover and exploit it. Measured by IS→OOS information ratio degradation." },
    ]
  },
  {
    id: "hft", name: "Market Microstructure & HFT", color: "#10b981", cards: [
      { q: "What is the bid-ask spread?",                                           a: "Difference between the lowest ask (sell) and highest bid (buy) price. Composed of: order processing cost, inventory risk premium, and adverse selection component." },
      { q: "What is adverse selection in market making?",                           a: "Risk that a counterparty is better-informed. Informed traders systematically trade against market makers when they hold private information, leading to losses." },
      { q: "What is market impact?",                                                a: "Price movement caused by a trade. Temporary impact reverts; permanent impact reflects information. Models: √(Q) (square root law), linear, Almgren-Chriss." },
      { q: "What is the Almgren-Chriss model?",                                     a: "Optimal execution model that trades off market impact cost against volatility risk during liquidation. Gives a closed-form trajectory minimising expected cost + λ·variance." },
      { q: "What is co-location?",                                                  a: "Placing trading servers physically inside or adjacent to exchange data centres to minimise round-trip latency. HFT firms pay for co-location to gain microsecond advantages." },
      { q: "What is a dark pool?",                                                  a: "Private exchange for trading large blocks of securities without pre-trade transparency, to reduce market impact. Orders are not visible to the public until after execution." },
      { q: "What is TWAP vs VWAP execution?",                                       a: "TWAP: executes equal shares at regular time intervals. VWAP: executes proportional to historical volume profile. VWAP is harder to game and minimises market impact on average." },
      { q: "What is latency arbitrage?",                                            a: "Profiting from speed advantage: observing price changes on one exchange before they propagate to another, and trading ahead of the update. Microsecond-level exploits." },
      { q: "What is order book imbalance?",                                         a: "OBI = (Qᵦᵢ𝒹 − Q𝒶ₛₖ) / (Qᵦᵢ𝒹 + Q𝒶ₛₖ). Short-term price pressure predictor: positive OBI → price likely to rise. Used as a feature in HFT alpha models." },
      { q: "What is the price impact of a trade?",                                  a: "Immediate price impact ∝ sign(Q)·√|Q| empirically. Permanent impact ∝ information content. Decomposition: P(t+dt) = P(t) + impact + noise." },
    ]
  },
  {
    id: "brain", name: "Mental Maths & Puzzles", color: "#6366f1", cards: [
      { q: "What is 17 × 23?",                                                      a: "391. Method: 17×23 = 17×20 + 17×3 = 340 + 51 = 391." },
      { q: "A fair coin is flipped until you get 2 consecutive heads. What is the expected number of flips?",  a: "6. States: start, 1H, HH(done). E₀ = 1 + ½E₁ + ½E₀, E₁ = 1 + ½·0 + ½E₀. Solving: E₀ = 6." },
      { q: "You have 100 light bulbs and 10 floors. Minimise flips to find the lowest floor that breaks a bulb.",  a: "Optimal drop floors: 10,19,27,34,40,45,49,52,54,55 (triangular number strategy). Worst case: 19 drops." },
      { q: "What is P(rolling at least one 6 in 4 dice rolls)?",                    a: "1 − (5/6)⁴ = 1 − 625/1296 ≈ 0.518. More likely than not." },
      { q: "Two trains, 200km apart, travel toward each other at 50km/h each. A fly at 100km/h bounces between them. How far does the fly travel?",  a: "100 km. The trains meet in 2 hours. The fly travels for 2 hours at 100 km/h = 200 km. Wait — actually 200km because the total distance closes at 100km/h combined. Fly: 100×2 = 200 km." },
      { q: "What is log₂(1024)?",                                                   a: "10. Since 2¹⁰ = 1024. Useful: log₂(1000) ≈ 9.97." },
      { q: "Three cards: GG, RR, GR. You draw one card and see Green on one side. P(other side Green)?",  a: "2/3. There are 3 green faces. 2 are on GG (both sides green) and 1 on GR. Given you see green, probability of being on GG = 2/3." },
      { q: "Estimate √2 quickly.",                                                  a: "√2 ≈ 1.414. Remember: 1.4² = 1.96, 1.41² = 1.9881, 1.414² ≈ 1.9996. Also √2 = 1 + 1/(2 + 1/(2 + ...)) continued fraction." },
      { q: "E[X] where X = number of rolls to get a 6?",                            a: "6. Geometric distribution with p=1/6. E[X] = 1/p = 6." },
      { q: "100 people, 100 seats, first person sits randomly. Everyone else sits in their seat or randomly if taken. P(last person gets their seat)?",  a: "1/2. The last seat taken is either seat 1 or seat 100, equally likely by symmetry." },
    ]
  },
]


const daysUntil = (dateStr) => {
  if (!dateStr || dateStr === "TBA" || dateStr === "Ongoing" || dateStr.includes("TBA")) return null
  const d = new Date(dateStr)
  const now = new Date()
  const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24))
  return diff
}

const formatDate = (d) => {
  if (!d || d === "TBA") return "TBA"
  try {
    return new Date(d).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })
  } catch { return d }
}

const CATEGORY_COLORS = {
  "Algo Trading": "#C17F3A",
  "ML & Data Science": "#6366f1",
  "ML & Alpha Research": "#8b5cf6",
  "Options & Market Making": "#ec4899",
  "Quant Research": "#0ea5e9",
  "Discovery Program": "#10b981",
  "Fellowship": "#14b8a6",
  "Conference": "#94a3b8",
  "Trading Simulation": "#f97316",
  "Portfolio Management": "#84cc16",
  "Competitive Programming": "#e879f9",
  "Research": "#fb923c",
}

// ── SUBJECT_COLORS: subject name → accent color ──────────────────────────────
// FILE: src/constants/config.js  (when splitting)
// Both old and new name variants included for backwards-compatibility
const SUBJECT_COLORS = {
  // Keys here become the filter TAGS in LearningPath — canonical names only
  "Mathematics":         "#C17F3A",
  "Comp Sci":            "#6366f1",
  "Programming":         "#10b981",
  "Finance & Economics": "#0ea5e9",
  "Machine Learning":    "#ec4899",
}
// Aliases used only for colour lookups — NOT rendered as filter tags
const SUBJECT_COLOR_LOOKUP = {
  ...SUBJECT_COLORS,
  "Finance and Economics": "#0ea5e9",
  "Machine learning":      "#ec4899",
}

// ─────────────────────────────────────────────
//  STORAGE HOOK
// ─────────────────────────────────────────────


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/hooks/useStorage.js  (when splitting into separate files)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const useStorage = (key, fallback) => {
  const [val, setVal] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? JSON.parse(stored) : fallback
    } catch { return fallback }
  })
  const save = useCallback((v) => {
    setVal(prev => {
      const next = typeof v === "function" ? v(prev) : v
      try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
      return next
    })
  }, [key])
  return [val, save]
}

// ─────────────────────────────────────────────
//  MODULE: DASHBOARD
// ─────────────────────────────────────────────


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/components/modules/Dashboard.jsx  (when splitting into separate files)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/components/modules/Dashboard.jsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENT: Onboarding — 3-step walkthrough overlay, shown once on first login
// Trigger manually via "Tour" button on Mission Control
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TOUR_STEPS = [
  {
    icon:"🎯",
    title:"Welcome to QuantOS",
    body:"Your all-in-one quant career operating system. Track 118 courses, competitions, interview prep, research papers and networking — all in one place.",
    cta:"Let's go →",
  },
  {
    icon:"📐",
    title:"Build your skill tree",
    body:"Head to Learning Path → Tree View to see a visual map of your quant curriculum. Courses unlock as you complete prerequisites. Right-click any node to mark progress.",
    cta:"Got it →",
  },
  {
    icon:"🏆",
    title:"Track competitions",
    body:"Open Competitions to see every quant challenge with live deadlines. Export all deadlines to your calendar in one click. Apply early — spots fill fast.",
    cta:"Next →",
  },
  {
    icon:"🧠",
    title:"Practice interviews",
    body:"Interview Prep uses AI to generate custom questions and grade your answers. Weak categories are surfaced automatically so you know exactly what to practice next.",
    cta:"Next →",
  },
  {
    icon:"⬡",
    title:"Your Quant Readiness Score",
    body:"Mission Control shows a live pentagon radar tracking your strength across Math, CS, ML, Finance and Interview Prep. Every course you complete moves the needle.",
    cta:"Start →",
  },
]

const Onboarding = ({ onDone, isDark }) => {
  const [step, setStep] = useState(0)
  const s = TOUR_STEPS[step]
  const isLast = step === TOUR_STEPS.length - 1

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9999,
      background:"rgba(4,4,12,0.88)",
      backdropFilter:"blur(18px)", WebkitBackdropFilter:"blur(18px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      animation:"qos-fade 0.25s ease",
    }}>
      <div style={{
        width:440, borderRadius:24,
        background: isDark ? "rgba(10,10,26,0.97)" : "rgba(255,255,255,0.97)",
        border:"1px solid rgba(193,127,58,0.22)",
        boxShadow:"0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset",
        overflow:"hidden",
        animation:"qos-fade 0.2s ease",
      }}>
        {/* Progress bar */}
        <div style={{height:3, background:"rgba(255,255,255,0.06)"}}>
          <div style={{height:"100%", background:"linear-gradient(90deg,#C17F3A,#A86B2E)",
            width:`${((step+1)/TOUR_STEPS.length)*100}%`, transition:"width 0.35s ease"}}/>
        </div>

        <div style={{padding:"40px 40px 36px"}}>
          {/* Icon */}
          <div style={{fontSize:52, marginBottom:20, textAlign:"center", lineHeight:1}}>{s.icon}</div>

          {/* Step counter */}
          <div style={{fontSize:10, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace",
            letterSpacing:"0.14em", textAlign:"center", marginBottom:12}}>
            STEP {step+1} OF {TOUR_STEPS.length}
          </div>

          {/* Title */}
          <div style={{fontSize:22, fontWeight:800, fontFamily:"'Syne',sans-serif",
            color: isDark?"#f1f5f9":"#1a1a2e", textAlign:"center", marginBottom:14, lineHeight:1.25}}>
            {s.title}
          </div>

          {/* Body */}
          <div style={{fontSize:14, color: isDark?"#8896aa":"#64748b",
            lineHeight:1.75, textAlign:"center", marginBottom:32}}>
            {s.body}
          </div>

          {/* Step dots */}
          <div style={{display:"flex", justifyContent:"center", gap:6, marginBottom:28}}>
            {TOUR_STEPS.map((_,i)=>(
              <div key={i} onClick={()=>setStep(i)} style={{
                width: i===step ? 20 : 6, height:6, borderRadius:3,
                background: i===step ? "#C17F3A" : "rgba(193,127,58,0.22)",
                transition:"all 0.25s", cursor:"pointer",
              }}/>
            ))}
          </div>

          {/* Actions */}
          <div style={{display:"flex", gap:10}}>
            <button onClick={onDone}
              style={{flex:1, padding:"11px 0", borderRadius:12,
                border:`1px solid ${isDark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.07)"}`,
                background:"transparent", color:"#475569",
                fontSize:13, cursor:"pointer"}}>
              Skip tour
            </button>
            <button onClick={()=> isLast ? onDone() : setStep(s=>s+1)}
              style={{flex:2, padding:"11px 0", borderRadius:12,
                border:"1px solid rgba(193,127,58,0.4)",
                background:"linear-gradient(135deg,rgba(193,127,58,0.22),rgba(217,119,6,0.18))",
                color:"#C17F3A", fontSize:13, fontWeight:700, cursor:"pointer"}}>
              {s.cta}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENT: QuantReadinessRadar — SVG pentagon web chart
// 5 axes: Math · CS & Prog · Machine Learning · Finance · Interview
// Values derived live from courseProgress + interview_history
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const QuantReadinessRadar = ({ courseProgress, interviewHistory, T }) => {
  const txt    = T?.text    || "#f1f5f9"
  const sub    = T?.textSub || "#64748b"
  const isDark = (T?.text || "#f1f5f9").startsWith("#f") || (T?.text||"").startsWith("#e")

  const AXES = [
    { label:"Mathematics",    color:"#6366f1", key:"Mathematics" },
    { label:"CS & Prog",      color:"#0ea5e9", key:"cs_prog" },
    { label:"Machine Learning",color:"#10b981",key:"Machine Learning" },
    { label:"Finance",        color:"#C17F3A", key:"Finance & Economics" },
    { label:"Interview",      color:"#ec4899", key:"interview" },
  ]

  const scores = AXES.map(ax => {
    if (ax.key === "cs_prog") {
      const courses = COURSES.filter(c=>c.subject==="Comp Sci"||c.subject==="Programming")
      const done    = courses.filter(c=>courseProgress[c.id]===1).length
      return courses.length ? done/courses.length : 0
    }
    if (ax.key === "interview") {
      if (!interviewHistory.length) return 0
      const avg = interviewHistory.reduce((a,b)=>a+b.score,0)/interviewHistory.length
      return avg/10
    }
    const courses = COURSES.filter(c=>c.subject===ax.key)
    const done    = courses.filter(c=>courseProgress[c.id]===1).length
    return courses.length ? done/courses.length : 0
  })

  const overallScore = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*100)

  // Pentagon geometry
  const CX=130, CY=115, R=82, N=5
  const angle = i => (i*2*Math.PI/N) - Math.PI/2

  const gridLevels = [0.25,0.5,0.75,1]
  const polyPoints = (vals, scale=1) =>
    vals.map((v,i) => {
      const a=angle(i); const r=v*R*scale
      return `${CX+r*Math.cos(a)},${CY+r*Math.sin(a)}`
    }).join(" ")

  // Score fill polygon
  const fillPoly = scores.map((v,i)=>{
    const a=angle(i); const r=v*R
    return `${CX+r*Math.cos(a)},${CY+r*Math.sin(a)}`
  }).join(" ")

  return (
    <div style={{
      background:T?.cardBg||"rgba(255,255,255,0.04)",
      border:`1px solid ${T?.cardBorder||"rgba(255,255,255,0.08)"}`,
      borderRadius:14, padding:"20px 24px",
      display:"flex", flexDirection:"column", gap:0,
    }}>
      <div style={{fontSize:11,color:sub,textTransform:"uppercase",
        letterSpacing:"0.08em",marginBottom:14,fontFamily:"'JetBrains Mono',monospace"}}>
        ⬡ Quant Readiness Radar
      </div>

      <div style={{display:"flex", alignItems:"center", gap:20, flexWrap:"wrap"}}>
        {/* SVG radar — fluid on mobile, fixed on desktop */}
        <svg width="100%" viewBox="0 0 260 230"
          style={{flexShrink:0, maxWidth:260, overflow:"visible", display:"block"}}>
          <defs>
            <radialGradient id="radar-fill" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#C17F3A" stopOpacity="0.35"/>
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.10"/>
            </radialGradient>
          </defs>

          {/* Grid rings */}
          {gridLevels.map(lvl=>(
            <polygon key={lvl}
              points={polyPoints(Array(N).fill(lvl))}
              fill="none" stroke="rgba(180,90,40,0.45)" strokeWidth={1} strokeDasharray="3,3"/>
          ))}

          {/* Axis spokes */}
          {AXES.map((_,i)=>{
            const a=angle(i)
            return <line key={i}
              x1={CX} y1={CY}
              x2={CX+R*Math.cos(a)} y2={CY+R*Math.sin(a)}
              stroke="rgba(180,90,40,0.35)" strokeWidth={1}/>
          })}

          {/* Score fill */}
          <polygon points={fillPoly}
            fill="url(#radar-fill)"
            stroke="rgba(193,127,58,0.55)" strokeWidth={1.5}
            strokeLinejoin="round"/>

          {/* Score dots */}
          {scores.map((v,i)=>{
            const a=angle(i); const r=v*R
            return <circle key={i}
              cx={CX+r*Math.cos(a)} cy={CY+r*Math.sin(a)} r={4}
              fill={AXES[i].color} stroke="rgba(0,0,0,0.4)" strokeWidth={1}/>
          })}

          {/* Axis labels */}
          {AXES.map((ax,i)=>{
            const a=angle(i), labelR=R+20
            const lx=CX+labelR*Math.cos(a), ly=CY+labelR*Math.sin(a)
            return (
              <g key={i}>
                <text x={lx} y={ly}
                  textAnchor={ Math.abs(Math.cos(a))<0.15 ? "middle" : Math.cos(a)>0 ? "start" : "end" }
                  dominantBaseline="middle"
                  fontSize={8.5} fontWeight={600} fill={ax.color}
                  fontFamily="'JetBrains Mono',monospace">
                  {ax.label}
                </text>
                <text x={lx} y={ly+11}
                  textAnchor={ Math.abs(Math.cos(a))<0.15 ? "middle" : Math.cos(a)>0 ? "start" : "end" }
                  dominantBaseline="middle"
                  fontSize={8} fill={sub} fontFamily="'JetBrains Mono',monospace">
                  {Math.round(scores[i]*100)}%
                </text>
              </g>
            )
          })}

          {/* Centre score */}
          <text x={CX} y={CY-6} textAnchor="middle" fontSize={22} fontWeight={800}
            fill="#C17F3A" fontFamily="'Syne',sans-serif">{overallScore}</text>
          <text x={CX} y={CY+10} textAnchor="middle" fontSize={8} fill={sub}
            fontFamily="'JetBrains Mono',monospace">OVERALL</text>
        </svg>

        {/* Legend + axis breakdown */}
        <div style={{flex:1,minWidth:140,display:"flex",flexDirection:"column",gap:10}}>
          {AXES.map((ax,i)=>(
            <div key={ax.label} style={{display:"flex",flexDirection:"column",gap:3}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:ax.color,fontFamily:"'JetBrains Mono',monospace",
                  fontWeight:600}}>{ax.label}</span>
                <span style={{fontSize:11,color:sub,fontFamily:"'JetBrains Mono',monospace"}}>
                  {Math.round(scores[i]*100)}%
                </span>
              </div>
              <div style={{height:3,borderRadius:3,background:"rgba(128,128,128,0.12)"}}>
                <div style={{height:"100%",borderRadius:3,background:ax.color,
                  width:`${scores[i]*100}%`,transition:"width 1s ease"}}/>
              </div>
            </div>
          ))}
          <div style={{marginTop:4,fontSize:10,color:sub,lineHeight:1.5}}>
            Complete courses & interviews to grow your radar.
          </div>
        </div>
      </div>
    </div>
  )
}

const Dashboard = ({ courseProgress, bookmarks, T, onStartTour, navigate, isMobile }) => {
  const txt   = T?.text      || "#C8956A"
  const sub   = T?.textSub   || "#8B6250"
  const muted = T?.textMuted || "#5a3828"
  const bg    = T?.cardBg    || "rgba(255,255,255,0.04)"
  const bdr   = T?.cardBorder|| "rgba(180,90,40,0.18)"

  const [dashTab, setDashTab]         = useState("overview")   // "overview" | "timetable" | "memory"
  const [ttMode, setTtMode]           = useState(() => [0,6].includes(new Date().getDay()) ? "weekend" : "weekday")

  const [interviewHistory]           = useStorage("interview_history", [])
  const [weeklyGoal, setWeeklyGoal]  = useStorage("weekly_goal_days_v1", 5)
  const [reviewSchedule]             = useStorage("review_schedule_v1", {})
  const [contacts]                   = useStorage("networking_contacts_v1", [])
  const [studyLog]                   = useStorage("study_log_v1", {})
  const [lectureProgress]            = useStorage("lecture_progress_v2", {})

  const completed    = COURSES.filter(c => courseProgress[c.id] === 1).length
  const inProgress   = COURSES.filter(c => courseProgress[c.id] === 0.5).length
  const totalCourses = COURSES.length
  const todayKey     = new Date().toISOString().slice(0, 10)

  const streak = (() => {
    let count = 0; let d = new Date()
    while (true) { const k=d.toISOString().slice(0,10); if(!studyLog[k]) break; count++; d.setDate(d.getDate()-1) }
    return count
  })()
  const totalStudyDays = Object.keys(studyLog).length
  const studiedToday   = !!studyLog[todayKey]
  const weekStart = (() => { const d=new Date(); const day=d.getDay(); d.setDate(d.getDate()-(day===0?6:day-1)); return d.toISOString().slice(0,10) })()
  const weekDays = Object.keys(studyLog).filter(k=>k>=weekStart).length
  const monthPrefix = new Date().toISOString().slice(0,7)
  const monthDays   = Object.keys(studyLog).filter(k=>k.startsWith(monthPrefix)).length
  const monthInterviews = interviewHistory.filter(h=>h.date&&h.date.includes(new Date().getFullYear().toString())).length
  const subjectStats = Object.entries(SUBJECT_COLORS).map(([subj,color])=>{
    const sc=COURSES.filter(c=>c.subject===subj); const done=sc.filter(c=>courseProgress[c.id]===1).length
    return { subj,color,done,total:sc.length,pct:sc.length?Math.round(done/sc.length*100):0 }
  })
  const upcoming = COMPETITIONS.filter(c=>c.status!=="closed"&&c.deadline&&c.deadline!=="TBA"&&!c.deadline.includes("TBA")&&!c.deadline.includes("Closed")&&!c.deadline.includes("Open")&&!c.deadline.includes("Rolling")&&!c.deadline.includes("Ongoing")&&!c.deadline.includes("Multiple")).map(c=>({...c,days:daysUntil(c.deadline)})).filter(c=>c.days!==null&&c.days>=0).sort((a,b)=>a.days-b.days).slice(0,5)
  const openCount = COMPETITIONS.filter(c=>c.status==="open").length
  const tbaCount  = COMPETITIONS.filter(c=>c.status==="tba").length

  // ── Detect which courses the user is actively working on ──────────────────
  const activeMathCourse   = COURSES.find(c=>c.subject==="Mathematics"&&courseProgress[c.id]===0.5) || COURSES.find(c=>c.id==="m0")
  const activeProbCourse   = COURSES.find(c=>(c.subject==="Mathematics"||c.subject==="Comp Sci")&&c.name.toLowerCase().includes("prob")&&courseProgress[c.id]===0.5) || COURSES.find(c=>c.id==="c1")
  const activeProgCourse   = COURSES.find(c=>c.subject==="Programming"&&courseProgress[c.id]===0.5) || COURSES.find(c=>c.id==="p6")
  const activeCSCourse     = COURSES.find(c=>c.subject==="Comp Sci"&&courseProgress[c.id]===0.5) || COURSES.find(c=>c.id==="c0")
  const activeFinCourse    = COURSES.find(c=>c.subject==="Finance & Economics"&&courseProgress[c.id]===0.5) || COURSES.find(c=>c.id==="f0")

  // Tab bar
  const TABS = [
    { id:"overview",   label:"Overview",      icon:"◈" },
    { id:"timetable",  label:"Timetable",     icon:"⏱" },
    { id:"memory",     label:"Memory Curve",  icon:"⟁" },
  ]

  // ── Today's Focus — derive the single most actionable thing ─────────────────
  const todayFocus = (() => {
    // 1. Overdue review?
    const today = new Date().toISOString().slice(0,10)
    const overdueIds = Object.entries(reviewSchedule).filter(([,d])=>d<=today).map(([id])=>id)
    if (overdueIds.length) {
      const c = COURSES.find(c=>c.id===overdueIds[0])
      if (c) return { icon:"↻", color:"#ef4444", label:"Review overdue", detail:`${c.name} — revision due`, action:"learning" }
    }
    // 2. In-progress course — next lecture
    const inProgressCourse = COURSES.find(c=>courseProgress[c.id]===0.5)
    if (inProgressCourse) {
      const sched = Object.values(SCHEDULES||{}).find(s=>s.code===inProgressCourse.code)
      if (sched) {
        const done = sched.lectures.filter(l=>lectureProgress[`${inProgressCourse.id}_l${l.n}`]===1).length
        const next = sched.lectures[done]
        if (next) return { icon:"▶", color:T.accent, label:inProgressCourse.code, detail:`Lecture ${next.n}: ${next.title}`, action:"learning" }
      }
      return { icon:"▶", color:T.accent, label:inProgressCourse.code, detail:`Continue: ${inProgressCourse.name}`, action:"learning" }
    }
    // 3. No courses started — cold start
    if (completed === 0 && inProgress === 0) return { icon:"🎯", color:T.accent, label:"Start here", detail:"Open Learning Path → pick your first course", action:"learning", isStart:true }
    // 4. All caught up
    return { icon:"✓", color:"#10b981", label:"You're on track", detail:"No urgent actions — keep your streak going", action:null }
  })()

  return (
    <div style={{ padding:"0 0 40px" }}>

      {/* ── Today's Focus — always at the very top ── */}
      <div onClick={()=>todayFocus.action&&navigate(todayFocus.action)}
        style={{ marginBottom:24, background: T.cardBgHi, border:`1px solid ${todayFocus.color}30`,
          borderRadius:14, padding:"16px 20px", cursor:todayFocus.action?"pointer":"default",
          display:"flex", alignItems:"center", gap:16,
          transition:"border-color 0.2s",
        }}>
        <div style={{ width:44, height:44, borderRadius:12, background:`${todayFocus.color}15`,
          border:`1px solid ${todayFocus.color}30`, display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:20, flexShrink:0 }}>
          {todayFocus.icon}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:10, color:T.textMuted, fontFamily:"'JetBrains Mono',monospace",
            letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:3 }}>
            Today's Focus
          </div>
          <div style={{ fontSize:15, fontWeight:700, color:todayFocus.color,
            fontFamily:"'Syne',sans-serif", marginBottom:2 }}>{todayFocus.label}</div>
          <div style={{ fontSize:12, color:T.textSub }}>{todayFocus.detail}</div>
        </div>
        {todayFocus.action && (
          <div style={{ fontSize:18, color:`${todayFocus.color}80`, flexShrink:0 }}>→</div>
        )}
      </div>

      {/* ── Empty state — cold start ── */}
      {completed === 0 && inProgress === 0 && (
        <div style={{ marginBottom:24, background:T.cardBg, border:`1px solid ${T.accentBorder}`,
          borderRadius:14, padding:"24px", textAlign:"center" }}>
          <div style={{ fontSize:36, marginBottom:12 }}>⬡</div>
          <div style={{ fontSize:18, fontWeight:800, color:T.textHeading,
            fontFamily:"'Syne',sans-serif", marginBottom:8 }}>Welcome to QuantOS</div>
          <div style={{ fontSize:13, color:T.textSub, lineHeight:1.7, marginBottom:18, maxWidth:380, margin:"0 auto 18px" }}>
            You haven't started any courses yet. Head to Learning Path to pick your first one — 18.01 Calculus is the recommended starting point for most quant tracks.
          </div>
          <button onClick={()=>navigate("learning")}
            style={{ padding:"10px 28px", borderRadius:10, border:`1px solid ${T.accentBorder}`,
              background:T.accentDim, color:T.accent, fontSize:13, fontWeight:700,
              cursor:"pointer", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.06em" }}>
            → Start Learning Path
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom:20, display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:700, color:txt, fontFamily:"'Syne', sans-serif", margin:0 }}>Mission Control</h1>
          <p style={{ color:sub, margin:"4px 0 0", fontSize:13 }}>
            {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
          </p>
        </div>
        <button onClick={onStartTour}
          style={{ padding:"7px 16px", borderRadius:10, border:"1px solid rgba(193,127,58,0.3)",
            background:"rgba(193,127,58,0.08)", color:"#C17F3A", fontSize:11,
            cursor:"pointer", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.06em", whiteSpace:"nowrap", flexShrink:0 }}>
          ⬡ Start Tour
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display:"flex", gap:6, marginBottom:22, borderBottom:`1px solid ${bdr}`, paddingBottom:0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setDashTab(t.id)}
            style={{
              padding:"8px 16px", borderRadius:"10px 10px 0 0", border:"none",
              background: dashTab===t.id ? "rgba(193,127,58,0.12)" : "transparent",
              color: dashTab===t.id ? "#C17F3A" : sub,
              fontSize:12, fontWeight:700, cursor:"pointer",
              borderBottom: dashTab===t.id ? "2px solid #C17F3A" : "2px solid transparent",
              fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.04em",
              transition:"all 0.18s",
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          TAB: OVERVIEW (original dashboard content)
      ══════════════════════════════════════════════════════════════ */}
      {dashTab === "overview" && (<>

        {/* KPI Row */}
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:isMobile?10:14, marginBottom:24 }}>
          {[
            { label:"Courses Done",      value:completed,  sub:`/ ${totalCourses} total`,      color:"#C17F3A" },
            { label:"In Progress",       value:inProgress, sub:"active courses",               color:"#6366f1" },
            { label:"Open Competitions", value:openCount,  sub:"apply now",                    color:"#10b981" },
            { label:"Coming Soon",       value:tbaCount,   sub:"competitions TBA",             color:"#0ea5e9" },
            { label:"Study Streak",      value:streak,     sub:studiedToday?"🔥 active today":"study today to continue", color:streak>6?"#C17F3A":streak>2?"#10b981":"#6366f1" },
          ].map(k=>(
            <div key={k.label} style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:isMobile?"12px 14px":"18px 20px" }}>
              <div style={{ fontSize:11, color:muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8, fontFamily:"'JetBrains Mono',monospace" }}>{k.label}</div>
              <div style={{ fontSize:36, fontWeight:800, color:k.color, lineHeight:1, fontFamily:"'Syne',sans-serif" }}>{k.value}</div>
              <div style={{ fontSize:12, color:sub, marginTop:4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:18 }}>
          {/* Subject Progress */}
          <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"20px 24px" }}>
            <div style={{ fontSize:12, color:muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:18, fontFamily:"'JetBrains Mono',monospace" }}>Progress by Subject</div>
            {subjectStats.map(s=>(
              <div key={s.subj} style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <span style={{ fontSize:13, color:txt }}>{s.subj}</span>
                  <span style={{ fontSize:12, color:s.color, fontFamily:"'JetBrains Mono',monospace" }}>{s.done}/{s.total}</span>
                </div>
                <div style={{ height:4, borderRadius:4, background:"rgba(128,128,128,0.12)", overflow:"hidden" }}>
                  <div style={{ height:"100%", borderRadius:4, background:s.color, width:`${s.pct}%`, transition:"width 1s ease" }}/>
                </div>
              </div>
            ))}
          </div>

          {/* Upcoming Deadlines */}
          <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"20px 24px" }}>
            <div style={{ fontSize:12, color:muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:18, fontFamily:"'JetBrains Mono',monospace" }}>Upcoming Deadlines</div>
            {upcoming.length===0&&<p style={{color:sub,fontSize:13}}>No imminent deadlines.</p>}
            {upcoming.map(c=>(
              <div key={c.id} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, padding:"10px 14px", background:"rgba(128,128,128,0.05)", borderRadius:8, border:"1px solid rgba(128,128,128,0.08)" }}>
                <div style={{ minWidth:44, textAlign:"center" }}>
                  <div style={{ fontSize:22, fontWeight:800, color:c.days<=7?"#ef4444":c.days<=14?"#C17F3A":"#10b981", fontFamily:"'Syne',sans-serif", lineHeight:1 }}>{c.days}</div>
                  <div style={{ fontSize:10, color:muted }}>days</div>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, color:txt, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.name}</div>
                  <div style={{ fontSize:11, color:sub }}>Deadline: {formatDate(c.deadline)}</div>
                </div>
                <a href={c.link} target="_blank" rel="noreferrer" style={{ fontSize:10, color:"#6366f1", textDecoration:"none", border:"1px solid rgba(99,102,241,0.3)", padding:"3px 8px", borderRadius:4, whiteSpace:"nowrap" }}>Apply →</a>
              </div>
            ))}
          </div>
        </div>

        {/* Internship Deadlines */}
        {(()=>{
          const upcomingInterns=INTERNSHIPS.filter(i=>i.status!=="closed").map(i=>({...i,days:daysUntil(i.deadline)})).filter(i=>i.days!==null&&i.days>=0&&i.days<=120).sort((a,b)=>a.days-b.days).slice(0,4)
          if(!upcomingInterns.length) return null
          return (
            <div style={{ marginTop:18, background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"20px 24px" }}>
              <div style={{ fontSize:12, color:muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:14, fontFamily:"'JetBrains Mono',monospace" }}>⏰ Internship Deadlines — Next 120 Days</div>
              <div style={{ display:"grid", gridTemplateColumns:`repeat(auto-fill,minmax(${isMobile?"100%":"280px"},1fr))`, gap:10 }}>
                {upcomingInterns.map(i=>(
                  <div key={i.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:bg, borderRadius:8, border:`1px solid ${i.days<=14?"rgba(239,68,68,0.25)":bdr}` }}>
                    <div style={{ minWidth:40, textAlign:"center" }}>
                      <div style={{ fontSize:20, fontWeight:800, color:i.days<=14?"#ef4444":i.days<=30?"#C17F3A":"#10b981", fontFamily:"'Syne',sans-serif", lineHeight:1 }}>{i.days}</div>
                      <div style={{ fontSize:9, color:muted }}>days</div>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, color:txt, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{i.company}</div>
                      <div style={{ fontSize:10, color:sub, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{i.role}</div>
                    </div>
                    <a href={i.link} target="_blank" rel="noreferrer" style={{ fontSize:10, color:"#6366f1", textDecoration:"none", border:"1px solid rgba(99,102,241,0.3)", padding:"3px 8px", borderRadius:4, whiteSpace:"nowrap", flexShrink:0 }}>Apply →</a>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Radar + Weekly + Monthly */}
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:18, marginTop:18 }}>
          <QuantReadinessRadar courseProgress={courseProgress} interviewHistory={interviewHistory} T={T}/>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {/* Weekly Goal */}
            <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:14, padding:"18px 22px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div style={{ fontSize:11,color:muted,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:"'JetBrains Mono',monospace" }}>📅 Weekly Study Goal</div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <button onClick={()=>setWeeklyGoal(g=>Math.max(1,g-1))} style={{ width:22,height:22,borderRadius:6,border:`1px solid ${bdr}`,background:"transparent",color:sub,cursor:"pointer",fontSize:14,lineHeight:1 }}>−</button>
                  <span style={{ fontSize:13,color:txt,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",minWidth:18,textAlign:"center" }}>{weeklyGoal}</span>
                  <button onClick={()=>setWeeklyGoal(g=>Math.min(7,g+1))} style={{ width:22,height:22,borderRadius:6,border:`1px solid ${bdr}`,background:"transparent",color:sub,cursor:"pointer",fontSize:14,lineHeight:1 }}>+</button>
                  <span style={{ fontSize:11,color:muted }}>days/wk</span>
                </div>
              </div>
              <div style={{ display:"flex", gap:5, marginBottom:10 }}>
                {["M","T","W","T","F","S","S"].map((d,i)=>{
                  const date=new Date(); const dow=date.getDay(); const mon=dow===0?6:dow-1
                  const offset=i-mon; const past=new Date(date); past.setDate(date.getDate()+offset)
                  const k=past.toISOString().slice(0,10); const studied=!!studyLog[k]
                  const isToday=offset===0; const isFuture=offset>0
                  return <div key={i} style={{ flex:1,aspectRatio:"1",borderRadius:8, background:studied?"rgba(16,185,129,0.25)":isToday?"rgba(193,127,58,0.10)":T?.rowBg||"rgba(0,0,0,0.03)", border:`1px solid ${studied?"rgba(16,185,129,0.5)":isToday?"rgba(193,127,58,0.4)":T?.rowBorder||"rgba(0,0,0,0.06)"}`, display:"flex",alignItems:"center",justifyContent:"center", fontSize:9,fontFamily:"'JetBrains Mono',monospace", color:studied?"#10b981":isToday?"#C17F3A":isFuture?T?.textDisabled||"rgba(0,0,0,0.18)":sub }}>{studied?"✓":d}</div>
                })}
              </div>
              <div style={{ height:4,borderRadius:4,background:T?.trackBg||"rgba(0,0,0,0.08)",overflow:"hidden",marginBottom:6 }}>
                <div style={{ height:"100%",borderRadius:4,transition:"width 0.5s ease", background:weekDays>=weeklyGoal?"#10b981":"linear-gradient(90deg,#6366f1,#C17F3A)", width:`${Math.min(weekDays/weeklyGoal,1)*100}%` }}/>
              </div>
              <div style={{ fontSize:11,color:sub }}>{weekDays}/{weeklyGoal} days this week{weekDays>=weeklyGoal&&<span style={{color:"#10b981",marginLeft:8}}>🎯 Goal reached!</span>}</div>
            </div>
            {/* Monthly Report */}
            <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:14, padding:"18px 22px", flex:1 }}>
              <div style={{ fontSize:11,color:muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14,fontFamily:"'JetBrains Mono',monospace" }}>📊 {new Date().toLocaleDateString("en-GB",{month:"long"})} Report</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {[{label:"Study Days",value:monthDays,color:"#6366f1"},{label:"Interviews",value:monthInterviews,color:"#ec4899"},{label:"Current Streak",value:`${streak}d`,color:"#C17F3A"},{label:"Total Sessions",value:totalStudyDays,color:"#10b981"}].map(s=>(
                  <div key={s.label} style={{ background:bg,borderRadius:10,padding:"10px 12px",border:`1px solid ${bdr}` }}>
                    <div style={{ fontSize:20,fontWeight:800,color:s.color,fontFamily:"'Syne',sans-serif",lineHeight:1 }}>{s.value}</div>
                    <div style={{ fontSize:10,color:muted,marginTop:3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <button onClick={()=>navigate&&navigate("interview")} style={{ marginTop:12,width:"100%",padding:"8px 0",borderRadius:8, border:"1px solid rgba(236,72,153,0.2)",background:"rgba(236,72,153,0.06)", color:"#ec4899",fontSize:11,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace" }}>→ Practice Interview Questions</button>
            </div>
          </div>
        </div>

        {/* Action Items */}
        {(()=>{
          const today=new Date().toISOString().slice(0,10)
          const reviewsDue=Object.entries(reviewSchedule).filter(([,due])=>due<=today).map(([id])=>COURSES.find(c=>c.id===id)).filter(Boolean)
          const followUps=contacts.filter(c=>{ if(!c.date||c.status==="Closed") return false; return Math.floor((new Date()-new Date(c.date))/86400000)>=21&&["Connected","Messaged","Replied"].includes(c.status) })
          if(!reviewsDue.length&&!followUps.length) return null
          return (
            <div style={{ marginTop:18, background:bg, border:"1px solid rgba(193,127,58,0.18)", borderRadius:12, padding:"18px 22px" }}>
              <div style={{ fontSize:11, color:"#C17F3A", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:14, fontFamily:"'JetBrains Mono',monospace" }}>🔔 Action Items</div>
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:14 }}>
                {reviewsDue.length>0&&<div>
                  <div style={{ fontSize:10,color:muted,marginBottom:8 }}>📚 Course Reviews Due ({reviewsDue.length})</div>
                  {reviewsDue.slice(0,4).map(c=>(<div key={c.id} onClick={()=>navigate&&navigate("learning")} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(239,68,68,0.05)",borderRadius:8,marginBottom:5,border:"1px solid rgba(239,68,68,0.12)",cursor:"pointer" }}><span style={{fontSize:10,color:"#ef4444"}}>↻</span><span style={{fontSize:11,color:txt,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span><span style={{fontSize:9,color:"#ef4444",fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>overdue</span></div>))}
                  {reviewsDue.length>4&&<div style={{fontSize:10,color:muted}}>+{reviewsDue.length-4} more</div>}
                </div>}
                {followUps.length>0&&<div>
                  <div style={{ fontSize:10,color:muted,marginBottom:8 }}>🤝 Follow-up Needed ({followUps.length})</div>
                  {followUps.slice(0,4).map(c=>{ const ds=Math.floor((new Date()-new Date(c.date))/86400000); return (<div key={c.id} onClick={()=>navigate&&navigate("networking")} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(193,127,58,0.05)",borderRadius:8,marginBottom:5,border:"1px solid rgba(193,127,58,0.12)",cursor:"pointer" }}><span style={{fontSize:10,color:"#C17F3A"}}>→</span><div style={{flex:1,minWidth:0}}><div style={{fontSize:11,color:txt,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div><div style={{fontSize:9,color:muted}}>{c.firm}</div></div><span style={{fontSize:9,color:"#C17F3A",fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>{ds}d ago</span></div>) })}
                  {followUps.length>4&&<div style={{fontSize:10,color:muted}}>+{followUps.length-4} more</div>}
                </div>}
              </div>
            </div>
          )
        })()}

        {/* ── Flow Card — horizontal timeline matching user's drawing ── */}
        {(() => {
          const FLOW_STEPS = [
            { icon:"📖", label:"Skim\nTopic",    desc:"Scan structure first",          color:"#7a6050" },
            { icon:"▶",  label:"Watch\nLecture", desc:"Stay focused, note gaps",       color:"#7a6050" },
            { icon:"📚", label:"Read\nChapter",  desc:"Tie lecture to text",           color:"#7a6050" },
            { icon:"✏",  label:"2–3\nProblems",  desc:"Solve without peeking",         color:"#7a6050" },
            { icon:"🔍", label:"Analyse\nErrors", desc:"Why did it fail or work?",     color:"#7a6050" },
            { icon:"🧠", label:"Recall &\nNotes", desc:"Write from memory. This sticks",color:"#C8956A" },
          ]
          const n = FLOW_STEPS.length
          // SVG layout
          const SVG_W = 620, SVG_H = 180
          const L = 30, R = SVG_W - 30
          const lineY = 100
          const step = (R - L) / (n - 1)
          const xs = FLOW_STEPS.map((_, i) => L + i * step)

          return (
            <div style={{ marginTop:18, background:bg, border:`1px solid rgba(180,90,40,0.22)`, borderRadius:14, padding:"20px 20px 16px" }}>
              <div style={{ fontSize:11, color:"#C8956A", textTransform:"uppercase", letterSpacing:"0.10em", fontFamily:"'JetBrains Mono',monospace", marginBottom:14 }}>✦ Study Flow — Optimal Learning Order</div>
              <div style={{ overflowX:"auto" }}>
                <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ display:"block", minWidth:360 }}>

                  {/* Horizontal line */}
                  <line x1={L} y1={lineY} x2={R} y2={lineY}
                    stroke="rgba(180,90,40,0.35)" strokeWidth={2}/>
                  {/* Arrow tip */}
                  <path d={`M ${R-6},${lineY-5} L ${R+4},${lineY} L ${R-6},${lineY+5}`}
                    fill="none" stroke="rgba(180,90,40,0.45)" strokeWidth={2}/>

                  {FLOW_STEPS.map((s, i) => {
                    const x = xs[i]
                    const isAbove = i % 2 === 0  // alternating above/below like the drawing
                    const cardY = isAbove ? lineY - 82 : lineY + 18
                    const tickTop = isAbove ? lineY - 14 : lineY + 2
                    const tickH = 14

                    return (
                      <g key={i}>
                        {/* Tick mark from line */}
                        <line x1={x} y1={tickTop} x2={x} y2={tickTop + tickH}
                          stroke="rgba(180,90,40,0.45)" strokeWidth={1.5}/>

                        {/* Dot on line */}
                        <circle cx={x} cy={lineY} r={4}
                          fill="#110703" stroke="rgba(180,90,40,0.65)" strokeWidth={2}/>

                        {/* Icon */}
                        <text x={x} y={isAbove ? cardY + 14 : cardY + 14}
                          textAnchor="middle" fontSize={16} dominantBaseline="middle">{s.icon}</text>

                        {/* Label (2 lines via tspan) */}
                        {s.label.split("\n").map((line, li) => (
                          <text key={li} x={x} y={isAbove ? cardY + 30 + li * 13 : cardY + 30 + li * 13}
                            textAnchor="middle" fontSize={9.5} fontWeight={700}
                            fill="#C8956A" fontFamily="'JetBrains Mono',monospace">{line}</text>
                        ))}

                        {/* Step desc */}
                        <text x={x} y={isAbove ? cardY + 58 : cardY + 58}
                          textAnchor="middle" fontSize={8} fill="rgba(139,98,80,0.85)"
                          fontFamily="'JetBrains Mono',monospace">{s.desc.length > 18 ? s.desc.slice(0,18)+"…" : s.desc}</text>

                        {/* Step number */}
                        <text x={x} y={isAbove ? lineY - 20 : lineY + 18}
                          textAnchor="middle" fontSize={8} fill="rgba(180,90,40,0.5)"
                          fontFamily="'JetBrains Mono',monospace">{i+1}</text>
                      </g>
                    )
                  })}

                </svg>
              </div>
            </div>
          )
        })()}

        {/* Quick Links */}
        <div style={{ marginTop:18, background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 24px" }}>
          <div style={{ fontSize:12, color:muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12, fontFamily:"'JetBrains Mono',monospace" }}>Quick Access Platforms</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {PLATFORMS.slice(0,7).map(p=>(
              <a key={p.name} href={p.url} target="_blank" rel="noreferrer" style={{ fontSize:12, color:sub, textDecoration:"none", background:bg, border:`1px solid ${bdr}`, padding:"6px 12px", borderRadius:6, transition:"all 0.2s", display:"inline-block" }}
                onMouseEnter={e=>{e.target.style.color="#C8956A";e.target.style.borderColor="rgba(180,90,40,0.4)"}}
                onMouseLeave={e=>{e.target.style.color=sub;e.target.style.borderColor=bdr}}>
                {p.name}
              </a>
            ))}
          </div>
        </div>
      </>)}

      {/* ══════════════════════════════════════════════════════════════
          TAB: TIMETABLE
      ══════════════════════════════════════════════════════════════ */}
      {dashTab === "timetable" && (<>
        {/* Weekday / Weekend toggle */}
        <div style={{ display:"flex", gap:8, marginBottom:24, alignItems:"center" }}>
          {["weekday","weekend"].map(m=>(
            <button key={m} onClick={()=>setTtMode(m)}
              style={{ padding:"7px 20px", borderRadius:20, border:`1px solid ${ttMode===m?"rgba(193,127,58,0.5)":bdr}`,
                background:ttMode===m?"rgba(193,127,58,0.12)":"transparent",
                color:ttMode===m?"#C17F3A":sub, fontSize:12, fontWeight:700,
                cursor:"pointer", fontFamily:"'JetBrains Mono',monospace",
                letterSpacing:"0.06em", transition:"all 0.18s" }}>
              {m==="weekday"?"⚡ Weekdays":"🌿 Weekends"}
            </button>
          ))}
          <span style={{ fontSize:11, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>
            {new Date().toLocaleDateString("en-GB",{weekday:"long"})} — {[0,6].includes(new Date().getDay())?"Weekend":"Weekday"}
          </span>
        </div>

        {/* Heading */}
        <div style={{ fontSize:22, fontWeight:800, color:txt, fontFamily:"'Syne',sans-serif", marginBottom:24, fontStyle:"italic" }}>
          A Hopeful Plan · {ttMode==="weekday"?"Weekdays":"Weekends"}
        </div>

        {ttMode === "weekday" && (() => {
          const blocks = [
            { time:"5:00 AM",  above:true,  icon:"📋", label:"Review Yesterday's Notes",  detail:"1 hr — reinforce what you learned before new input", color:"#C17F3A" },
            { time:"6:00 AM",  above:false, icon:"📐", label: activeMathCourse?.code||"18.01",    detail:`${activeMathCourse?.name||"Single Variable Calculus"} · 2–3 hr`, color:"#6366f1" },
            { time:"9:00 AM",  above:true,  icon:"🎲", label: activeProbCourse?.code||"6.041",    detail:`${activeProbCourse?.name||"Probabilistic Systems Analysis"} · 2–3 hr`, color:"#ec4899" },
            { time:"12:00 PM", above:false, icon:"💻", label: activeProgCourse?.code||"Python",   detail:`${activeProgCourse?.name||"Python Programming"} · 2–3 hr`, color:"#10b981" },
            { time:"3:00 PM",  above:true,  icon:"🖥",  label: activeCSCourse?.code||"6.042J",    detail:`${activeCSCourse?.name||"Mathematics for Computer Science"} · 2 hr`, color:"#0ea5e9" },
            { time:"5:00 PM",  above:false, icon:"📈", label: activeFinCourse?.code||"ECON 252",  detail:`${activeFinCourse?.name||"Financial Theory"} · 2 hr`, color:"#f97316" },
            { time:"7:00 PM",  above:true,  icon:"📖", label:"Reading Session",             detail:"2–3 hr — textbook chapter for tomorrow's lecture", color:"#8b5cf6" },
            { time:"9:00 PM",  above:false, icon:"📝", label:"Today's Notes",               detail:"30 min — review and clean up what you captured today", color:"#14b8a6" },
            { time:"9:30 PM",  above:true,  icon:"🧠", label:"Recall",                      detail:"30 min — close everything, write from memory", color:"#C17F3A" },
          ]
          return <TimetableView blocks={blocks} T={T} isMobile={isMobile} />
        })()}

        {ttMode === "weekend" && (() => {
          const blocks = [
            { time:"5:00 AM",  above:true,  icon:"📋", label:"Review Yesterday's Notes",         detail:"1 hr — start with active recall before anything else", color:"#C17F3A" },
            { time:"6:00 AM",  above:false, icon:"📐", label:"Maths Problem Solving",             detail:`${activeMathCourse?.name||"Calculus"} — do 5–10 problems, no peeking`, color:"#6366f1" },
            { time:"8:00 AM",  above:true,  icon:"🎲", label:"Probability Problem Solving",       detail:`${activeProbCourse?.name||"Stat 110"} — work through problem sets`, color:"#ec4899" },
            { time:"10:00 AM", above:false, icon:"💻", label:"Programming — Model Systems",       detail:"Code a simulation of what you studied in probability this week", color:"#10b981" },
            { time:"1:00 PM",  above:true,  icon:"🖥",  label:"Computer Science / Architecture",  detail:activeProbCourse?.name||"Revision and synthesis across CS courses", color:"#0ea5e9" },
            { time:"3:00 PM",  above:false, icon:"✍",  label:"Maths Assumptions Journal",         detail:"Write every implicit assumption you made when solving this week's problems", color:"#f97316" },
            { time:"4:30 PM",  above:true,  icon:"📖", label:"Linear Algebra / Calculus II",      detail:"Reinforce the mathematical foundations underneath everything else", color:"#8b5cf6" },
            { time:"6:00 PM",  above:false, icon:"🧠", label:"Recall & Make Notes",               detail:"30 min — summarise the entire week in your own words", color:"#C17F3A" },
          ]
          return <TimetableView blocks={blocks} T={T} isMobile={isMobile} />
        })()}

        {/* Flow reminder at bottom of timetable */}
        <div style={{ marginTop:24, background:bg, border:"1px solid rgba(193,127,58,0.15)", borderRadius:12, padding:"14px 18px" }}>
          <div style={{ fontSize:10, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", marginBottom:8, letterSpacing:"0.08em" }}>✦ FLOW — within each study block follow this sequence</div>
          <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap", fontSize:11, color:sub }}>
            {["Skim Topic","Watch Lecture","Read Book","Do 2–3 Problems","Analyse Errors","Recall & Notes"].map((s,i,a)=>(
              <span key={s} style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ color:txt }}>{s}</span>
                {i<a.length-1&&<span style={{color:"rgba(193,127,58,0.4)"}}>→</span>}
              </span>
            ))}
          </div>
        </div>
      </>)}

      {/* ══════════════════════════════════════════════════════════════
          TAB: MEMORY CURVE
      ══════════════════════════════════════════════════════════════ */}
      {dashTab === "memory" && (
        <MemoryRetentionChart courseProgress={courseProgress} lectureProgress={lectureProgress} studyLog={studyLog} T={T} isMobile={isMobile} />
      )}

    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENT: TimetableView — horizontal timeline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TimetableView = ({ blocks, T, isMobile }) => {
  const txt   = T?.text      || "#C8956A"
  const sub   = T?.textSub   || "#8B6250"
  const muted = T?.textMuted || "#5a3828"
  const bg    = T?.cardBg    || "rgba(255,255,255,0.04)"
  const bdr   = T?.cardBorder|| "rgba(180,90,40,0.18)"

  if (isMobile) {
    // Mobile: vertical list
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
        {blocks.map((b, i) => (
          <div key={i} style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
            {/* Timeline line + dot */}
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0, width:40 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:b.color, flexShrink:0, marginTop:14 }}/>
              {i < blocks.length-1 && <div style={{ width:2, flex:1, minHeight:32, background:`linear-gradient(180deg,${b.color}40,transparent)` }}/>}
            </div>
            {/* Block */}
            <div style={{ background:bg, border:`1px solid ${b.color}30`, borderRadius:10, padding:"12px 14px", marginBottom:10, flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <span style={{ fontSize:16 }}>{b.icon}</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:b.color }}>{b.label}</div>
                  <div style={{ fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>{b.time}</div>
                </div>
              </div>
              <div style={{ fontSize:11, color:sub, lineHeight:1.5 }}>{b.detail}</div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Desktop: horizontal timeline (like user's drawing)
  return (
    <div style={{ overflowX:"auto", paddingBottom:8 }}>
      <div style={{ minWidth: blocks.length * 130 + 60, position:"relative", paddingTop:180, paddingBottom:180 }}>

        {/* Horizontal line */}
        <div style={{ position:"absolute", top:"50%", left:20, right:20, height:2, background:`linear-gradient(90deg,rgba(200,149,106,0.15),rgba(200,149,106,0.4),rgba(200,149,106,0.15))`, transform:"translateY(-50%)" }}/>

        {/* 5am label at left */}
        <div style={{ position:"absolute", top:"50%", left:4, transform:"translateY(-50%)", fontSize:11, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>5am</div>

        {/* Blocks */}
        {blocks.map((b, i) => {
          const x = 60 + i * 130
          const isAbove = b.above

          return (
            <div key={i} style={{ position:"absolute", left:x, top:"50%", transform:"translateY(-50%)" }}>

              {/* Vertical tick */}
              <div style={{ position:"absolute", left:"50%", transform:"translateX(-50%)", width:2, background:`${b.color}60`,
                top: isAbove ? -80 : 14, height:72 }}/>

              {/* Dot on line */}
              <div style={{ position:"absolute", left:"50%", top:0, transform:"translate(-50%,-50%)",
                width:12, height:12, borderRadius:"50%", background:b.color,
                border:"1px solid rgba(180,90,40,0.3)" }}/>

              {/* Card: above or below line */}
              <div style={{
                position:"absolute", left:"50%", transform:"translateX(-50%)",
                top: isAbove ? "auto" : 20,
                bottom: isAbove ? 20 : "auto",
                width:118, background:`${b.color}10`,
                border:`1px solid ${b.color}35`, borderRadius:10,
                padding:"10px 10px",
                display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center",
              }}>
                <div style={{ fontSize:18, marginBottom:4 }}>{b.icon}</div>
                <div style={{ fontSize:10, fontWeight:700, color:b.color, marginBottom:3, fontFamily:"'JetBrains Mono',monospace", lineHeight:1.2 }}>{b.label}</div>
                <div style={{ fontSize:9, color:muted, lineHeight:1.4 }}>{b.detail}</div>
                <div style={{ fontSize:9, color:b.color, fontFamily:"'JetBrains Mono',monospace", marginTop:5, opacity:0.7 }}>{b.time}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENT: MemoryRetentionChart — Ebbinghaus forgetting curve SVG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MemoryRetentionChart = ({ courseProgress, lectureProgress, studyLog, T, isMobile }) => {
  const txt   = T?.text      || "#C8956A"
  const sub   = T?.textSub   || "#8B6250"
  const muted = T?.textMuted || "#5a3828"
  const bg    = T?.cardBg    || "rgba(255,255,255,0.04)"
  const bdr   = T?.cardBorder|| "rgba(180,90,40,0.18)"

  const VW = 620   // viewBox width — always full size, SVG scales
  const VH = 300
  const W = VW
  const H = VH
  const PAD = { l:44, r:20, t:24, b:44 }
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b

  // X: days 0–30 (with compression kink at day 8 → shows as 7 on axis)
  // Map day 0–7 linearly, then 8–30 compressed into remaining 25% of width
  const xForDay = (d) => {
    if (d <= 7) return PAD.l + (d / 7) * plotW * 0.75
    return PAD.l + plotW * 0.75 + ((d - 7) / 23) * plotW * 0.25
  }
  const yForPct = (p) => PAD.t + (1 - p / 100) * plotH

  // Ebbinghaus retention R(t) = e^(-t/S) where S = stability
  // Each revision multiplies stability by ~2.5 and resets to 100%
  // We draw 5 curves representing: no review, after R1, R2, R3, R4
  const decay = (t, S) => Math.round(100 * Math.exp(-t / S))
  const curves = [
    { S:0.9, color:"rgba(200,149,106,0.30)", finalPct:10, label:null },    // no review baseline
    { S:2.5, color:"rgba(200,149,106,0.50)", finalPct:20, label:null },
    { S:6,   color:"#8B9E7A",              finalPct:60, label:"60%" },
    { S:14,  color:"#a0b890",              finalPct:80, label:"80%" },
    { S:28,  color:"#c0d4a8",              finalPct:90, label:"90%" },
  ]

  // Revision markers: day 1, 3, 7, 14 (user's chart style)
  const revisions = [
    { day:1,  label:"1st Revision" },
    { day:3,  label:"2nd Revision" },
    { day:7,  label:"3rd Revision" },
    { day:14, label:"4th Revision" },
  ]

  // Studied topics from courseProgress
  const completedCourses = COURSES.filter(c => courseProgress[c.id] === 1).slice(-4)

  // Generate path for a curve from startDay to endDay
  const curvePath = (startDay, endDay, S, startPct) => {
    const steps = 40
    const pts = []
    for (let i = 0; i <= steps; i++) {
      const d = startDay + (endDay - startDay) * (i / steps)
      const p = startPct * Math.exp(-(d - startDay) / S)
      pts.push(`${xForDay(d)},${yForPct(p)}`)
    }
    return `M ${pts.join(" L ")}`
  }

  // Build segmented curves: each segment decays from 100% (after revision) with increasing stability
  const segments = [
    { from:0, to:1,  S:0.9,  startPct:100 },  // initial decay
    { from:1, to:3,  S:2.5,  startPct:100 },  // after 1st revision
    { from:3, to:7,  S:6,    startPct:100 },  // after 2nd
    { from:7, to:14, S:14,   startPct:100 },  // after 3rd
    { from:14, to:30, S:28,  startPct:100 },  // after 4th
  ]

  // Y axis labels
  const yTicks = [100, 80, 60, 40, 20, 0]
  const xTicks = [0, 1, 2, 3, 4, 5, 6, 7, 30]

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700, color:txt, fontFamily:"'Syne',sans-serif", marginBottom:4 }}>Memory Retention Over Time</div>
        <div style={{ fontSize:12, color:sub, lineHeight:1.6 }}>
          Each revision resets retention to 100% and slows the forgetting rate. After 4 revisions, your brain retains ~90% at the 30-day mark.
        </div>
      </div>

      {/* Chart */}
      <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:14, padding:"20px 16px" }}>
        <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display:"block", overflow:"visible" }}>

          {/* Grid lines */}
          {yTicks.map(p => (
            <g key={p}>
              <line x1={PAD.l} y1={yForPct(p)} x2={W-PAD.r} y2={yForPct(p)}
                stroke="rgba(200,149,106,0.08)" strokeWidth={1} strokeDasharray={p===0?"none":"3,4"}/>
              <text x={PAD.l-6} y={yForPct(p)+1} textAnchor="end" fontSize={9}
                fill={muted} fontFamily="'JetBrains Mono',monospace" dominantBaseline="middle">{p}%</text>
            </g>
          ))}

          {/* Y axis label */}
          <text x={10} y={H/2} textAnchor="middle" fontSize={9} fill={sub}
            fontFamily="'JetBrains Mono',monospace" transform={`rotate(-90,10,${H/2})`}>Memory Retention %</text>

          {/* Decay curve segments — each in their own color getting stronger */}
          {segments.map((seg, i) => {
            const colors = ["rgba(200,149,106,0.35)","rgba(180,160,100,0.55)","#8B9E7A","#a0b890","#c0d4a8"]
            const path = curvePath(seg.from, seg.to, seg.S, seg.startPct)
            return <path key={i} d={path} fill="none" stroke={colors[i]} strokeWidth={2.5} strokeLinecap="round"/>
          })}

          {/* Vertical kink line between day 7 and 30 */}
          {(() => {
            const x1 = xForDay(7) + 8; const x2 = xForDay(8) - 8
            return (
              <g>
                <line x1={x1} y1={PAD.t-10} x2={x1} y2={H-PAD.b+10} stroke="rgba(200,149,106,0.25)" strokeWidth={1} strokeDasharray="3,3"/>
                <text x={(x1+x2)/2} y={PAD.t-2} textAnchor="middle" fontSize={7} fill={muted} fontFamily="'JetBrains Mono',monospace">~</text>
              </g>
            )
          })()}

          {/* Revision vertical markers */}
          {revisions.map((r, i) => {
            const x = xForDay(r.day)
            const isAbove = i % 2 === 0
            return (
              <g key={i}>
                <line x1={x} y1={PAD.t} x2={x} y2={H-PAD.b} stroke={`rgba(193,127,58,0.22)`} strokeWidth={1} strokeDasharray="2,3"/>
                {/* Spike up to mark revision reset */}
                <path d={`M ${x-6},${yForPct(decay(r.day, segments[i]?.S||2)*0.7)} L ${x},${yForPct(100)} L ${x+6},${yForPct(decay(r.day, segments[i]?.S||2)*0.7)}`}
                  fill="none" stroke="rgba(193,127,58,0.6)" strokeWidth={1.5}/>
                <text x={x} y={isAbove ? PAD.t+10 : H-PAD.b-10}
                  textAnchor="middle" fontSize={8} fill="#C17F3A"
                  fontFamily="'JetBrains Mono',monospace">{r.label}</text>
              </g>
            )
          })}

          {/* Retention % labels at day 30 (kink end) */}
          {[["90%","#c0d4a8"],[" 80%","#a0b890"],["60%","#8B9E7A"]].map(([label,color],i) => (
            <text key={i} x={W-PAD.r+2} y={yForPct([90,80,60][i])} fontSize={9} fill={color}
              fontFamily="'JetBrains Mono',monospace" dominantBaseline="middle">{label}</text>
          ))}
          <text x={W-PAD.r+2} y={yForPct(10)} fontSize={9} fill="rgba(200,149,106,0.4)" fontFamily="'JetBrains Mono',monospace" dominantBaseline="middle">10%</text>

          {/* X axis */}
          <line x1={PAD.l} y1={H-PAD.b} x2={W-PAD.r} y2={H-PAD.b} stroke="rgba(200,149,106,0.3)" strokeWidth={1.5}/>
          {/* X arrow */}
          <path d={`M ${W-PAD.r-4},${H-PAD.b-4} L ${W-PAD.r+2},${H-PAD.b} L ${W-PAD.r-4},${H-PAD.b+4}`} fill="none" stroke="rgba(200,149,106,0.4)" strokeWidth={1.5}/>

          {/* X ticks */}
          {xTicks.map(d => (
            <g key={d}>
              <line x1={xForDay(d)} y1={H-PAD.b} x2={xForDay(d)} y2={H-PAD.b+4} stroke="rgba(200,149,106,0.3)" strokeWidth={1}/>
              <text x={xForDay(d)} y={H-PAD.b+13} textAnchor="middle" fontSize={9}
                fill={muted} fontFamily="'JetBrains Mono',monospace">
                {d===30?"30d":d}
              </text>
            </g>
          ))}
          <text x={(W-PAD.r+PAD.l)/2} y={H-2} textAnchor="middle" fontSize={9} fill={sub} fontFamily="'JetBrains Mono',monospace">Time elapsed in days</text>

        </svg>
      </div>

      {/* Studied topics pinned to revision points */}
      {completedCourses.length > 0 && (
        <div style={{ marginTop:16, background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 20px" }}>
          <div style={{ fontSize:11, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", marginBottom:12, letterSpacing:"0.06em" }}>YOUR COMPLETED COURSES — schedule these for revision</div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:8 }}>
            {completedCourses.map((c, i) => {
              const revLabel = ["1st Revision","2nd Revision","3rd Revision","4th Revision"][i % 4]
              const revColor = ["#C17F3A","#8B9E7A","#a0b890","#c0d4a8"][i % 4]
              return (
                <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"rgba(193,127,58,0.04)", borderRadius:8, border:`1px solid rgba(193,127,58,0.12)` }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:revColor, flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, color:txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</div>
                    <div style={{ fontSize:9, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>{c.code} · due {revLabel}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Revision schedule guide */}
      <div style={{ marginTop:14, background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 20px" }}>
        <div style={{ fontSize:11, color:muted, fontFamily:"'JetBrains Mono',monospace", marginBottom:12, letterSpacing:"0.06em" }}>OPTIMAL REVISION SCHEDULE</div>
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr 1fr 1fr", gap:10 }}>
          {[
            { rev:"1st", day:"Day 1",  retention:"~80% → 100%", color:"#C17F3A", note:"Review the same day" },
            { rev:"2nd", day:"Day 3",  retention:"~60% → 100%", color:"#8B9E7A", note:"48 hours later" },
            { rev:"3rd", day:"Day 7",  retention:"~60% → 100%", color:"#a0b890", note:"1 week later" },
            { rev:"4th", day:"Day 14+",retention:"~80–90%",     color:"#c0d4a8", note:"Long-term lock-in" },
          ].map(r=>(
            <div key={r.rev} style={{ background:`${r.color}08`, border:`1px solid ${r.color}25`, borderRadius:8, padding:"10px 12px", textAlign:"center" }}>
              <div style={{ fontSize:11, fontWeight:700, color:r.color, fontFamily:"'JetBrains Mono',monospace", marginBottom:4 }}>{r.rev}</div>
              <div style={{ fontSize:13, fontWeight:800, color:txt, fontFamily:"'Syne',sans-serif" }}>{r.day}</div>
              <div style={{ fontSize:9, color:muted, marginTop:4, lineHeight:1.4 }}>{r.note}</div>
              <div style={{ fontSize:8, color:r.color, marginTop:4, fontFamily:"'JetBrains Mono',monospace" }}>{r.retention}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
//  MODULE: LEARNING PATH
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  MIT OCW SCHEDULES  (lectures + problem sets)
// ─────────────────────────────────────────────
const OCW = "https://ocw.mit.edu/courses/"
const SCHEDULES = {
  m4: {
    code:"18.06", fullName:"Linear Algebra", textbook:"Introduction to Linear Algebra — Gilbert Strang (5th ed.)",
    playlistUrl:"https://www.youtube.com/playlist?list=PLE7DDD91010BC51F8",
    ocwUrl:OCW+"18-06-linear-algebra-spring-2010/",
    notesPage:OCW+"18-06-linear-algebra-spring-2010/pages/lecture-notes/",
    psPage:OCW+"18-06-linear-algebra-spring-2010/pages/assignments/",
    lectures:[
      {n:1,  title:"The Geometry of Linear Equations",                   ps:null},
      {n:2,  title:"Elimination with Matrices",                          ps:null},
      {n:3,  title:"Matrix Operations and Inverses",                     ps:"ps1"},
      {n:4,  title:"Factorization into A = LU",                          ps:null},
      {n:5,  title:"Transposes, Permutations, Spaces Rⁿ",                ps:"ps2"},
      {n:6,  title:"Column Space and Nullspace",                         ps:null},
      {n:7,  title:"Solving Ax = 0: Pivot Variables",                    ps:null},
      {n:8,  title:"Solving Ax = b: Row Reduced Form R",                 ps:"ps3"},
      {n:9,  title:"Independence, Basis, and Dimension",                 ps:null},
      {n:10, title:"The Four Fundamental Subspaces",                     ps:"ps4"},
      {n:11, title:"Matrix Spaces; Rank 1; Small World Graphs",          ps:null},
      {n:12, title:"Graphs, Networks, Incidence Matrices",               ps:"ps5"},
      {n:13, title:"🎯 Exam 1 Review",                                   ps:null},
      {n:14, title:"Orthogonal Vectors and Subspaces",                   ps:null},
      {n:15, title:"Projections onto Subspaces",                         ps:null},
      {n:16, title:"Projection Matrices and Least Squares",              ps:null},
      {n:17, title:"Orthogonal Matrices and Gram-Schmidt",               ps:"ps6"},
      {n:18, title:"Properties of Determinants",                         ps:null},
      {n:19, title:"Determinant Formulas and Cofactors",                 ps:null},
      {n:20, title:"Cramer's Rule, Inverse Matrix, and Volume",          ps:"ps7"},
      {n:21, title:"Eigenvalues and Eigenvectors",                       ps:null},
      {n:22, title:"Diagonalization and Powers of A",                    ps:null},
      {n:23, title:"Differential Equations and exp(At)",                 ps:null},
      {n:24, title:"Markov Matrices; Fourier Series",                    ps:"ps8"},
      {n:25, title:"🎯 Exam 2 Review",                                   ps:null},
      {n:26, title:"Symmetric Matrices and Positive Definiteness",       ps:null},
      {n:27, title:"Complex Matrices; Fast Fourier Transform",           ps:null},
      {n:28, title:"Positive Definite Matrices and Minima",              ps:"ps9"},
      {n:29, title:"Similar Matrices and Jordan Form",                   ps:null},
      {n:30, title:"Singular Value Decomposition (SVD)",                 ps:null},
      {n:31, title:"Linear Transformations and Their Matrices",          ps:null},
      {n:32, title:"Change of Basis; Image Compression",                ps:"ps10"},
      {n:33, title:"🎯 Exam 3 Review",                                   ps:null},
      {n:34, title:"Left and Right Inverses; Pseudoinverse",             ps:null},
      {n:35, title:"🏁 Final Review",                                    ps:null},
    ],
    problemSets:[
      {id:"ps1",  title:"PS 1",  assignedAfter:3,  covers:"L1–3: Systems of equations, elimination, matrix operations"},
      {id:"ps2",  title:"PS 2",  assignedAfter:5,  covers:"L4–5: LU factorization, permutations, vector spaces Rⁿ"},
      {id:"ps3",  title:"PS 3",  assignedAfter:8,  covers:"L6–8: Null/column spaces, RREF, complete solutions to Ax=b"},
      {id:"ps4",  title:"PS 4",  assignedAfter:10, covers:"L9–10: Independence, basis, dimension, four fundamental subspaces"},
      {id:"ps5",  title:"PS 5",  assignedAfter:12, covers:"L11–12: Rank-1 matrices, graph incidence matrices"},
      {id:"ps6",  title:"PS 6",  assignedAfter:17, covers:"L14–17: Orthogonality, projections, least squares, Gram-Schmidt"},
      {id:"ps7",  title:"PS 7",  assignedAfter:20, covers:"L18–20: Determinants, cofactors, Cramer's rule"},
      {id:"ps8",  title:"PS 8",  assignedAfter:24, covers:"L21–24: Eigenvalues, diagonalization, exp(At), Markov chains"},
      {id:"ps9",  title:"PS 9",  assignedAfter:28, covers:"L26–28: Symmetric matrices, positive definiteness"},
      {id:"ps10", title:"PS 10", assignedAfter:32, covers:"L29–32: Jordan form, SVD, linear transformations"},
    ],
  },
  m26: {
    code:"18.650", fullName:"Statistics for Applications", textbook:"All of Statistics — Larry Wasserman (free PDF via CMU)",
    playlistUrl:"https://www.youtube.com/playlist?list=PLUl4u3cNGP60uVBMaoNERc6knT_MgPKS0",
    ocwUrl:OCW+"18-650-statistics-for-applications-fall-2016/",
    notesPage:OCW+"18-650-statistics-for-applications-fall-2016/pages/lecture-slides/",
    psPage:OCW+"18-650-statistics-for-applications-fall-2016/pages/assignments/",
    lectures:[
      {n:1,  title:"Introduction to Statistics",                              ps:null},
      {n:2,  title:"Parametric Statistical Models",                           ps:"ps1"},
      {n:3,  title:"Maximum Likelihood Estimation (MLE)",                     ps:null},
      {n:4,  title:"Properties of MLE: Consistency & Asymptotic Normality",   ps:"ps2"},
      {n:5,  title:"Hypothesis Testing: Wald & Likelihood Ratio Tests",       ps:null},
      {n:6,  title:"Goodness of Fit: Chi-Square Test",                        ps:"ps3"},
      {n:7,  title:"Regression: Linear Models",                               ps:null},
      {n:8,  title:"Bayesian Statistics: Priors and Posteriors",              ps:"ps4"},
      {n:9,  title:"Bayesian: MAP, Credible Intervals",                       ps:null},
      {n:10, title:"Multivariate Statistics: Principal Component Analysis",   ps:"ps5"},
      {n:11, title:"Generalized Linear Models (GLMs)",                        ps:null},
      {n:12, title:"GLMs: Logistic and Poisson Regression",                   ps:"ps6"},
      {n:13, title:"Mixture Models",                                          ps:null},
      {n:14, title:"Expectation-Maximization (EM) Algorithm",                 ps:"ps7"},
      {n:15, title:"Computation Graphs and Backpropagation",                  ps:null},
      {n:16, title:"Neural Networks: Feedforward",                            ps:"ps8"},
      {n:17, title:"Monte Carlo Simulation",                                  ps:null},
      {n:18, title:"Markov Chains",                                           ps:"ps9"},
      {n:19, title:"Markov Decision Processes",                               ps:null},
      {n:20, title:"🏁 Final Review",                                         ps:null},
    ],
    problemSets:[
      {id:"ps1", title:"PS 1", assignedAfter:2,  covers:"L1–2: Identifiable models, sufficient statistics"},
      {id:"ps2", title:"PS 2", assignedAfter:4,  covers:"L3–4: MLE computation, Fisher information, asymptotic CIs"},
      {id:"ps3", title:"PS 3", assignedAfter:6,  covers:"L5–6: Hypothesis testing, p-values, chi-square goodness of fit"},
      {id:"ps4", title:"PS 4", assignedAfter:8,  covers:"L7–8: OLS regression, Bayesian inference, conjugate priors"},
      {id:"ps5", title:"PS 5", assignedAfter:10, covers:"L9–10: MAP estimators, credible intervals, PCA derivation"},
      {id:"ps6", title:"PS 6", assignedAfter:12, covers:"L11–12: GLM link functions, logistic regression MLE"},
      {id:"ps7", title:"PS 7", assignedAfter:14, covers:"L13–14: Gaussian mixture models, EM derivation"},
      {id:"ps8", title:"PS 8", assignedAfter:16, covers:"L15–16: Backpropagation calculus, feedforward nets"},
      {id:"ps9", title:"PS 9", assignedAfter:18, covers:"L17–18: Monte Carlo estimation, Markov chains, MCMC"},
    ],
  },
  c1: {
    code:"6.041SC", fullName:"Probabilistic Systems Analysis", textbook:"Introduction to Probability — Bertsekas & Tsitsiklis (2nd ed.)",
    playlistUrl:"https://www.youtube.com/playlist?list=PLUl4u3cNGP60A3XMwZ5sep719_nh95qOe",
    ocwUrl:OCW+"6-041sc-probabilistic-systems-analysis-and-applied-probability-fall-2013/",
    notesPage:OCW+"6-041sc-probabilistic-systems-analysis-and-applied-probability-fall-2013/pages/unit-i/",
    psPage:OCW+"6-041sc-probabilistic-systems-analysis-and-applied-probability-fall-2013/pages/assignments/",
    lectures:[
      {n:1,  title:"Probability Models and Axioms",                            ps:null},
      {n:2,  title:"Conditioning and Bayes' Rule",                             ps:"ps1"},
      {n:3,  title:"Independence",                                             ps:null},
      {n:4,  title:"Counting",                                                 ps:"ps2"},
      {n:5,  title:"Discrete Random Variables I: PMF, Expectation",           ps:null},
      {n:6,  title:"Discrete Random Variables II: Variance, CDF",             ps:"ps3"},
      {n:7,  title:"Discrete Random Variables III: Conditional Distributions", ps:null},
      {n:8,  title:"Continuous Random Variables",                              ps:"ps4"},
      {n:9,  title:"Multiple Continuous Random Variables",                     ps:null},
      {n:10, title:"Continuous Bayes' Rule; Derived Distributions",            ps:"ps5"},
      {n:11, title:"Covariance; Convolution",                                  ps:null},
      {n:12, title:"Iterated Expectations; Sum of Random Number of RVs",      ps:"ps6"},
      {n:13, title:"Bernoulli Process",                                        ps:null},
      {n:14, title:"Poisson Process I",                                        ps:"ps7"},
      {n:15, title:"Poisson Process II",                                       ps:null},
      {n:16, title:"Markov Chains I: Discrete Time",                          ps:"ps8"},
      {n:17, title:"Markov Chains II: Steady State",                          ps:null},
      {n:18, title:"Markov Chains III: Absorption, Convergence",              ps:null},
      {n:19, title:"Weak Law of Large Numbers",                                ps:"ps9"},
      {n:20, title:"Central Limit Theorem",                                    ps:null},
      {n:21, title:"Bayesian Statistical Inference I",                         ps:null},
      {n:22, title:"Bayesian Statistical Inference II",                        ps:"ps10"},
      {n:23, title:"Classical Statistical Inference I: MLE",                  ps:null},
      {n:24, title:"Classical Inference II: Hypothesis Testing",              ps:null},
      {n:25, title:"🏁 Final Review",                                          ps:null},
    ],
    problemSets:[
      {id:"ps1",  title:"PS 1",  assignedAfter:2,  covers:"L1–2: Sample spaces, probability laws, conditional probability"},
      {id:"ps2",  title:"PS 2",  assignedAfter:4,  covers:"L3–4: Independence of events, counting, combinations"},
      {id:"ps3",  title:"PS 3",  assignedAfter:6,  covers:"L5–6: Geometric/binomial/Poisson PMFs, expectation, variance"},
      {id:"ps4",  title:"PS 4",  assignedAfter:8,  covers:"L7–8: Conditional PMFs, continuous RVs, normal/exponential PDFs"},
      {id:"ps5",  title:"PS 5",  assignedAfter:10, covers:"L9–10: Joint distributions, continuous Bayes, derived distributions"},
      {id:"ps6",  title:"PS 6",  assignedAfter:12, covers:"L11–12: Covariance, correlation, iterated expectation"},
      {id:"ps7",  title:"PS 7",  assignedAfter:14, covers:"L13–14: Bernoulli/Poisson processes, memorylessness"},
      {id:"ps8",  title:"PS 8",  assignedAfter:16, covers:"L15–16: Poisson II, Markov chains, transition matrices"},
      {id:"ps9",  title:"PS 9",  assignedAfter:19, covers:"L17–19: Steady state, absorption, WLLN"},
      {id:"ps10", title:"PS 10", assignedAfter:22, covers:"L20–22: CLT, confidence intervals, Bayesian inference"},
    ],
  },
  c3: {
    code:"6.006", fullName:"Introduction to Algorithms", textbook:"Introduction to Algorithms (CLRS) — Cormen, Leiserson, Rivest, Stein",
    playlistUrl:"https://www.youtube.com/playlist?list=PLUl4u3cNGP61Oq3tWYp6V_F-5jb5L2iHb",
    ocwUrl:OCW+"6-006-introduction-to-algorithms-fall-2011/",
    notesPage:OCW+"6-006-introduction-to-algorithms-fall-2011/pages/lecture-notes/",
    psPage:OCW+"6-006-introduction-to-algorithms-fall-2011/pages/assignments/",
    lectures:[
      {n:1,  title:"Algorithmic Thinking, Peak Finding",                       ps:null},
      {n:2,  title:"Models of Computation, Document Distance",                 ps:"ps1"},
      {n:3,  title:"Insertion Sort, Merge Sort",                               ps:null},
      {n:4,  title:"Heaps and Heap Sort",                                      ps:"ps2"},
      {n:5,  title:"Binary Search Trees, BST Sort",                           ps:null},
      {n:6,  title:"AVL Trees, AVL Sort",                                      ps:null},
      {n:7,  title:"Counting Sort, Radix Sort, Lower Bounds for Sorting",      ps:"ps3"},
      {n:8,  title:"Hashing with Chaining",                                   ps:null},
      {n:9,  title:"Table Doubling, Karp-Rabin",                               ps:"ps4"},
      {n:10, title:"Open Addressing, Cryptographic Hashing",                  ps:null},
      {n:11, title:"Integer Arithmetic, Karatsuba Multiplication",            ps:"ps5"},
      {n:12, title:"Square Roots, Newton's Method",                           ps:null},
      {n:13, title:"Breadth-First Search (BFS)",                              ps:null},
      {n:14, title:"Depth-First Search, Topological Sorting",                 ps:"ps6"},
      {n:15, title:"Single-Source Shortest Paths Problem",                    ps:null},
      {n:16, title:"Dijkstra's Algorithm",                                    ps:null},
      {n:17, title:"Bellman-Ford Algorithm",                                  ps:"ps7"},
      {n:18, title:"Speeding up Dijkstra",                                    ps:null},
      {n:19, title:"Dynamic Programming I: Fibonacci, Shortest Paths",        ps:null},
      {n:20, title:"Dynamic Programming II: Text Justification, Blackjack",   ps:"ps8"},
      {n:21, title:"Dynamic Programming III: Edit Distance, Knapsack",        ps:null},
      {n:22, title:"Dynamic Programming IV: Guitar Fingering, Tetris",        ps:null},
    ],
    problemSets:[
      {id:"ps1", title:"PS 1", assignedAfter:2,  covers:"L1–2: Peak finding, O-notation, document distance"},
      {id:"ps2", title:"PS 2", assignedAfter:4,  covers:"L3–4: Sorting algorithms, heap operations"},
      {id:"ps3", title:"PS 3", assignedAfter:7,  covers:"L5–7: BST, AVL rotations, counting/radix sort"},
      {id:"ps4", title:"PS 4", assignedAfter:9,  covers:"L8–9: Hash functions, chaining, rolling hash"},
      {id:"ps5", title:"PS 5", assignedAfter:11, covers:"L10–11: Open addressing, Karatsuba multiplication"},
      {id:"ps6", title:"PS 6", assignedAfter:14, covers:"L13–14: BFS shortest paths, DFS, topological sort"},
      {id:"ps7", title:"PS 7", assignedAfter:17, covers:"L15–17: Dijkstra, Bellman-Ford, negative cycles"},
      {id:"ps8", title:"PS 8", assignedAfter:20, covers:"L19–20: DP memoization vs tabulation, text justification"},
    ],
  },
  c0: {
    code:"6.042J", fullName:"Mathematics for Computer Science", textbook:"Mathematics for Computer Science — Lehman, Leighton, Meyer (free PDF on OCW)",
    playlistUrl:"https://www.youtube.com/playlist?list=PLB7540DEDD482705B",
    ocwUrl:OCW+"6-042j-mathematics-for-computer-science-fall-2010/",
    notesPage:OCW+"6-042j-mathematics-for-computer-science-fall-2010/pages/readings/",
    psPage:OCW+"6-042j-mathematics-for-computer-science-fall-2010/pages/assignments/",
    lectures:[
      {n:1,  title:"Introduction and Proofs",                     ps:null},
      {n:2,  title:"Induction I",                                 ps:null},
      {n:3,  title:"Induction II",                                ps:"ps1"},
      {n:4,  title:"Number Theory I: Divisibility",               ps:null},
      {n:5,  title:"Number Theory II: GCD, Modular Arithmetic",   ps:"ps2"},
      {n:6,  title:"Graph Theory and Coloring",                   ps:null},
      {n:7,  title:"Matching Problems",                           ps:"ps3"},
      {n:8,  title:"Graph Theory II: Minimum Spanning Trees",     ps:null},
      {n:9,  title:"Communication Networks",                      ps:"ps4"},
      {n:10, title:"Graph Theory III: Directed Graphs, DAGs",     ps:null},
      {n:11, title:"Relations and Partial Orders",                ps:"ps5"},
      {n:12, title:"Sums",                                        ps:null},
      {n:13, title:"Sums and Asymptotics",                        ps:"ps6"},
      {n:14, title:"Divide-and-Conquer Recurrences",              ps:null},
      {n:15, title:"Linear Recurrences",                          ps:"ps7"},
      {n:16, title:"Counting Rules I",                            ps:null},
      {n:17, title:"Counting Rules II",                           ps:"ps8"},
      {n:18, title:"Probability Introduction",                    ps:null},
      {n:19, title:"Conditional Probability",                     ps:null},
      {n:20, title:"Independence",                                ps:"ps9"},
      {n:21, title:"Random Variables",                            ps:null},
      {n:22, title:"Expectation I",                               ps:null},
      {n:23, title:"Expectation II",                              ps:"ps10"},
      {n:24, title:"Large Deviations: Markov & Chebyshev Bounds", ps:null},
      {n:25, title:"Random Walks",                                ps:null},
    ],
    problemSets:[
      {id:"ps1",  title:"PS 1",  assignedAfter:3,  covers:"L1–3: Logic, proof methods, strong induction"},
      {id:"ps2",  title:"PS 2",  assignedAfter:5,  covers:"L4–5: Number theory, GCD, modular arithmetic, RSA"},
      {id:"ps3",  title:"PS 3",  assignedAfter:7,  covers:"L6–7: Graph coloring, bipartite matching, stable marriage"},
      {id:"ps4",  title:"PS 4",  assignedAfter:9,  covers:"L8–9: MST algorithms, networks, routing, latency"},
      {id:"ps5",  title:"PS 5",  assignedAfter:11, covers:"L10–11: DAGs, topological sort, partial orders"},
      {id:"ps6",  title:"PS 6",  assignedAfter:13, covers:"L12–13: Summation formulas, asymptotics"},
      {id:"ps7",  title:"PS 7",  assignedAfter:15, covers:"L14–15: Recurrences, master theorem"},
      {id:"ps8",  title:"PS 8",  assignedAfter:17, covers:"L16–17: Permutations, combinations, inclusion-exclusion"},
      {id:"ps9",  title:"PS 9",  assignedAfter:20, covers:"L18–20: Sample spaces, conditional probability, independence"},
      {id:"ps10", title:"PS 10", assignedAfter:23, covers:"L21–23: Random variables, expectation, variance"},
    ],
  },
}

// ─────────────────────────────────────────────
//  COMPONENT: COURSE DETAIL
// ─────────────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// YOUTUBE IFRAME PLAYER — free forever, no API key, no quota
// Uses YouTube IFrame Player API (just a JS library, not the Data API)
// Docs: https://developers.google.com/youtube/iframe_api_reference
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

