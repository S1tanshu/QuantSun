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
const YouTubePlayer = ({ playlistId, startIndex, onLectureDone, T }) => {
  const playerRef  = useRef(null)  // holds the YT.Player instance
  const divId      = useRef(`yt-${playlistId}-${Date.now()}`)
  const bdr = T?.cardBorder || "rgba(255,255,255,0.08)"

  ect(() => {useEff
    // ── Load the IFrame API script once globally ──────────────────────────────
    const loadAPI = (cb) => {
      if (window.YT && window.YT.Player) { cb(); return }
      const existing = document.getElementById("yt-iframe-api")
      if (!existing) {
        const s = document.createElement("script")
        s.id  = "yt-iframe-api"
        s.src = "https://www.youtube.com/iframe_api"
        document.body.appendChild(s)
      }
      // Queue callback — YouTube calls window.onYouTubeIframeAPIReady when ready
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        if (prev) prev()
        cb()
      }
    }

    // REPLACE the single useEffect with these two:

useEffect(() => {
  const loadAPI = (cb) => {
    if (window.YT && window.YT.Player) { cb(); return }
    const existing = document.getElementById("yt-iframe-api")
    if (!existing) {
      const s = document.createElement("script")
      s.id  = "yt-iframe-api"
      s.src = "https://www.youtube.com/iframe_api"
      document.body.appendChild(s)
    }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); cb() }
  }

  const createPlayer = () => {
    if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null }
    playerRef.current = new window.YT.Player(divId.current, {
      width: "100%", height: "100%",
      playerVars: { listType:"playlist", list:playlistId, index:startIndex, autoplay:0, rel:0, modestbranding:1 },
      events: {
        onStateChange: (e) => {
          if (e.data === 0) {
            const idx = playerRef.current.getPlaylistIndex()
            onLectureDone(idx + 1)
          }
        }
      }
    })
  }

  loadAPI(createPlayer)

  return () => {
    try { playerRef.current?.destroy() } catch(err) {}
    playerRef.current = null
  }
}, [playlistId])

useEffect(() => {
  if (startIndex == null) return
  if (playerRef.current && playerRef.current.playVideoAt) {
    playerRef.current.playVideoAt(startIndex)
  }
}, [startIndex])

    loadAPI(createPlayer)

    return () => {
      // Cleanup on unmount
      try { playerRef.current?.destroy() } catch {}
      playerRef.current = null
    }
  }, [playlistId, startIndex]) // re-create player if course changes

  return (
    <div style={{ width:"100%", aspectRatio:"16/9", borderRadius:12, overflow:"hidden",
      border:`1px solid ${bdr}`, background:"#000", marginBottom:20 }}>
      <div id={divId.current} style={{ width:"100%", height:"100%" }} />
    </div>
  )
}

const CourseDetail = ({ course, onBack, lectureProgress, setLectureProgress, setCourseProgress = ()=>{}, T, user, markStudyToday = ()=>{}, githubData = {} }) => {
 const LIVE_SCHEDULES = githubData.schedules || SCHEDULES
 const raw = LIVE_SCHEDULES[course.id]
const sched = (raw ? {
  ...raw,
  lectures:    raw.lectures    || [],
  problemSets: raw.problemSets || raw.psets || [],
  psets:       raw.psets       || [],
  notesPage:   raw.notesPage   || course.link,
  playlistUrl: raw.playlistUrl || course.playlistUrl || null,
} : null) || (() => {
  const total = parseInt(course.lectures?.split("/")?.[1])
  if (!total || isNaN(total)) return null
  return {
    playlistUrl: course.playlistUrl || null,
    notesPage:   course.link,
    problemSets: [],
    lectures: Array.from({ length: total }, (_, i) => ({
      n:     i + 1,
      title: `Lecture ${i + 1}`,
      ps:    false,
    }))
  }
})()

  const [tab, setTab] = useState("schedule")
  const subjColor = SUBJECT_COLOR_LOOKUP[course.subject] || "#64748b"
  const bg   = T?.cardBg    || "rgba(255,255,255,0.02)"
  const bdr  = T?.cardBorder|| "rgba(255,255,255,0.08)"
  const txt  = T?.text      || "#f1f5f9"
  const sub  = T?.textSub   || "#64748b"
  const muted= T?.textMuted || "#475569"
  const inBg = T?.inputBg   || "rgba(255,255,255,0.04)"

  // Per-user PS review storage — key includes user email so each account is isolated
  const userKey = `ps_reviews_${user?.email || "guest"}`
  const [psReviews, setPsReviews] = useStorage(userKey, {})

  // UI state for the submission panel
  const [expandedPs, setExpandedPs] = useState(null)   // ps.id currently open
  const [drafts, setDrafts] = useState({})              // { psId: textValue }
  const [reviewing, setReviewing] = useState(null)      // ps.id being reviewed

  // Open lecture in a new tab at the correct playlist position
  const [manualIndex, setManualIndex] = useState(null)

const openVideo = (n) => {
  if (!playlistId) {
    // No playlist — fall back to external link only if no embed possible
    window.open(sched.playlistUrl, "_blank", "noopener,noreferrer")
    return
  }
  setManualIndex(n - 1)   // YouTube IFrame API is 0-based
  setShowPlayer(true)
  // Scroll player into view
  setTimeout(() => {
    document.getElementById("yt-player-anchor")?.scrollIntoView({ behavior:"smooth", block:"start" })
  }, 100)
}

  // ── AI Review via Anthropic API ──
  const submitForReview = async (ps) => {
    const solution = drafts[ps.id]?.trim()
    if (!solution || solution.length < 30) return
    setReviewing(ps.id)
    try {
      const prompt = `You are a rigorous quantitative finance professor grading a student's problem set submission.

COURSE: ${sched?.fullName} (${sched?.code})
PROBLEM SET: ${ps.title} 
TOPICS COVERED: ${ps.covers}

STUDENT'S SUBMISSION:
"""
${solution}
"""

Grade this submission strictly and fairly. Return ONLY a JSON object (no markdown, no preamble) with this exact structure:
{
  "score": <integer 0-100>,
  "grade": "<A+|A|A-|B+|B|B-|C+|C|D|F>",
  "summary": "<2-sentence overall assessment>",
  "breakdown": {
    "conceptual_understanding": <0-25>,
    "mathematical_rigor": <0-25>,
    "problem_solving": <0-25>,
    "clarity_and_notation": <0-25>
  },
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"],
  "model_answer_hint": "<1-2 sentence hint about the ideal approach without giving away the full answer>"
}`

      if (!aiSettings?.key) throw new Error("NO_KEY")
      const raw = await callAI({ prompt, maxTokens: 1000, aiSettings })
      if (!raw) throw new Error("empty")
      const clean = raw.replace(/```json|```/g, "").trim()
      const review = JSON.parse(clean)

      setPsReviews(prev => ({
        ...prev,
        [`${course.id}_${ps.id}`]: {
          ...review,
          submittedAt: new Date().toISOString().slice(0, 10),
          solution: solution.slice(0, 500) // store first 500 chars for reference
        }
      }))
      setExpandedPs(null)
    } catch (e) {
      setPsReviews(prev => ({
        ...prev,
        [`${course.id}_${ps.id}`]: {
          score: null, error: "Review failed — please try again.",
          submittedAt: new Date().toISOString().slice(0, 10)
        }
      }))
    }
    setReviewing(null)
  }

  if (!sched) return (
    <div>
      <button onClick={onBack} style={{ background:"none", border:"none", color:"#C17F3A", cursor:"pointer", fontSize:13, marginBottom:20, padding:0 }}>← Back to Courses</button>
      <h1 style={{ fontSize:22, fontWeight:700, color:txt, fontFamily:"'Syne',sans-serif", marginBottom:8 }}>{course.name}</h1>
      <p style={{ color:sub, fontSize:13, marginBottom:20 }}>{course.institution} · {course.source} · Full schedule not yet mapped.</p>
      <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"20px 24px" }}>
        <p style={{ color:sub, marginBottom:12, fontSize:13 }}>Visit the official page for lectures and problem sets:</p>
        <a href={course.link} target="_blank" rel="noreferrer" style={{ color:"#C17F3A", fontSize:14 }}>Open Course Page →</a>
      </div>
    </div>
  )

 const toggleL = (n) => {
    markStudyToday()
    setLectureProgress(prev => {
      const k    = `${course.id}_l${n}`
      const next = { ...prev, [k]: prev[k] === 1 ? 0 : 1 }

      // ── Auto-sync course state based on lecture completions ──────────
      if (sched) {
        const total     = sched.lectures.length
        const doneCount = sched.lectures.filter(l => next[`${course.id}_l${l.n}`] === 1).length
        setCourseProgress(cp => ({
          ...cp,
          [course.id]: doneCount === 0 ? 0 : doneCount === total ? 1 : 0.5,
        }))
      }

      return next
    })
  }
  const isDone = (n) => lectureProgress[`${course.id}_l${n}`] === 1
  const doneCount = sched.lectures.filter(l => isDone(l.n)).length
  const pct = Math.round(doneCount / sched.lectures.length * 100)

  // ── YouTube player ────────────────────────────────────────────────────────
  const hasVideoIds = sched?.lectures?.some(l => l.videoId)
  const [showPlayer, setShowPlayer] = useState(!!hasVideoIds)
  const playlistId = sched.playlistUrl?.match(/[?&]list=([^&]+)/)?.[1] || null
  // Start at first unwatched lecture (0-based index for YT API)
  const startIndex = Math.max(0, sched.lectures.findIndex(l => !isDone(l.n)))
  // Auto-mark lecture done when video ends — called by YouTubePlayer
  const onLectureDone = (lectureNumber) => {
    markStudyToday(); setLectureProgress(prev => ({ ...prev, [`${course.id}_l${lectureNumber}`]: 1 }))
  }
  return (
    <div style={{ paddingBottom:60 }}>
      <button onClick={onBack} style={{ background:"none", border:"none", color:"#C17F3A", cursor:"pointer", fontSize:13, marginBottom:20, padding:0 }}>← Back to Courses</button>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12, marginBottom:20 }}>
        <div>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
            <span style={{ fontSize:11, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", background:"rgba(193,127,58,0.15)", padding:"2px 8px", borderRadius:4 }}>{sched.code}</span>
            <span style={{ fontSize:11, color:subjColor, background:"rgba(255,255,255,0.06)", padding:"2px 8px", borderRadius:4 }}>{course.subject}</span>
          </div>
          <h1 style={{ fontSize:22, fontWeight:800, color:txt, fontFamily:"'Syne',sans-serif", margin:0 }}>{sched.fullName}</h1>
          <p style={{ color:sub, fontSize:13, margin:"4px 0 0" }}>{course.institution} · {sched.lectures.length} Lectures · {sched.problemSets.length} Problem Sets</p>
          <p style={{ color:muted, fontSize:12, margin:"4px 0 0" }}>📖 {sched.textbook}</p>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {playlistId && (
            <button onClick={() => setShowPlayer(s => !s)}
              style={{ background: showPlayer ? "rgba(239,68,68,0.25)" : "rgba(239,68,68,0.15)",
                border:"1px solid rgba(239,68,68,0.3)", borderRadius:8, padding:"8px 14px",
                color:"#f87171", fontSize:12, cursor:"pointer", fontWeight:600 }}>
              {showPlayer ? "⏹ Close Player" : "▶ Watch Here"}
            </button>
          )}
          <a href={sched.playlistUrl} target="_blank" rel="noreferrer"
            style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)",
              borderRadius:8, padding:"8px 14px", color:"#f87171", fontSize:12, textDecoration:"none" }}>
            ↗ YouTube
          </a>
          <a href={sched.ocwUrl} target="_blank" rel="noreferrer"
            style={{ background:"rgba(193,127,58,0.1)", border:"1px solid rgba(193,127,58,0.3)",
              borderRadius:8, padding:"8px 14px", color:"#C17F3A", fontSize:12, textDecoration:"none" }}>
            🎓 MIT OCW
          </a>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:10, padding:"12px 20px", marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
          <span style={{ fontSize:12, color:sub }}>Lecture Progress</span>
          <span style={{ fontSize:12, fontFamily:"'JetBrains Mono',monospace", color:"#C17F3A" }}>{doneCount}/{sched.lectures.length} ({pct}%)</span>
        </div>
        <div style={{ height:6, borderRadius:4, background:"rgba(255,255,255,0.07)", overflow:"hidden" }}>
          <div style={{ height:"100%", background:"linear-gradient(90deg,#C17F3A,#10b981)", width:`${pct}%`, borderRadius:4, transition:"width 0.5s" }} />
        </div>
      </div>

     {/* Embedded YouTube player — auto-marks lectures done on video end */}
<div id="yt-player-anchor" />
{showPlayer && playlistId && (
  <YouTubePlayer
    playlistId={playlistId}
    startIndex={manualIndex ?? startIndex}
    onLectureDone={onLectureDone}
    T={T}
  />
)}
      {showPlayer && !playlistId && (
        <div style={{ background:"rgba(193,127,58,0.06)", border:"1px solid rgba(193,127,58,0.2)",
          borderRadius:10, padding:"14px 18px", marginBottom:20, fontSize:12, color:"#C17F3A" }}>
          No playlist ID found for this course. Use ↗ YouTube to watch externally.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        {[["schedule","📅 Schedule"],["problemsets","📝 Problem Sets"],["resources","🔗 Resources"]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding:"8px 18px", borderRadius:8, border:"1px solid", fontSize:13, cursor:"pointer",
            borderColor:tab===id?"#C17F3A":"rgba(255,255,255,0.1)",
            background:tab===id?"rgba(193,127,58,0.12)":"transparent",
            color:tab===id?"#C17F3A":sub }}>{label}</button>
        ))}
      </div>

      {tab === "schedule" && (
        <div>
          <p style={{ fontSize:12, color:muted, marginBottom:10 }}>
            Click <strong style={{color:"#ef4444"}}>▶ Watch Here</strong> above to open the embedded player — lectures auto-mark done when they finish.
            Or mark them manually below.
          </p>
          {/* Lecture table — horizontally scrollable on mobile so buttons never get cut */}
          <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch", width:"100%" }}>
            <div style={{ minWidth:480 }}>
              <div style={{ display:"grid", gridTemplateColumns:"40px 1fr 74px 84px 78px", marginBottom:6 }}>
                {["#","Lecture Title","Notes","Watch","Status"].map(h => (
                  <div key={h} style={{ fontSize:10, color:muted, textTransform:"uppercase", letterSpacing:"0.08em", padding:"6px 8px", fontFamily:"'JetBrains Mono',monospace" }}>{h}</div>
                ))}
              </div>
              {sched.lectures.map(l => {
                const done = isDone(l.n)
                const isExam = l.title.includes("🎯") || l.title.includes("🏁")
                return (
                  <div key={l.n} style={{ display:"grid", gridTemplateColumns:"40px 1fr 74px 84px 78px",
                    borderTop:`1px solid ${bdr}`, alignItems:"center",
                    background:done?"rgba(16,185,129,0.04)":isExam?"rgba(193,127,58,0.03)":"transparent" }}>
                    <div style={{ padding:"10px 8px", fontSize:12, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>{l.n}</div>
                    {/* Title cell — truncated so all rows stay the same height */}
                    <div style={{ padding:"10px 8px 10px 0", minWidth:0, display:"flex", alignItems:"center", gap:6, overflow:"hidden" }}>
                      <button onClick={() => !isExam && openVideo(l.n)}
                        style={{ fontSize:13, color:done?"#10b981":isExam?"#C17F3A":txt,
                          textDecoration:done?"line-through":"none", lineHeight:1,
                          background:"none", border:"none", padding:0,
                          cursor:isExam?"default":"pointer", textAlign:"left",
                          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%" }}>
                        {l.title}
                      </button>
                      {l.ps && <span style={{ fontSize:9, color:"#C17F3A", background:"rgba(193,127,58,0.15)", padding:"1px 5px", borderRadius:3, whiteSpace:"nowrap", flexShrink:0 }}>PS</span>}
                    </div>
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      {!isExam && <a href={sched.notesPage} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#0ea5e9", textDecoration:"none", whiteSpace:"nowrap" }}>Notes →</a>}
                    </div>
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      {!isExam && (
                        <button onClick={() => openVideo(l.n)}
                          style={{ fontSize:11, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:4, padding:"3px 9px", color:"#ef4444", cursor:"pointer", whiteSpace:"nowrap" }}>
                          ▶ Watch
                        </button>
                      )}
                    </div>
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      <button onClick={() => toggleL(l.n)} style={{ fontSize:11, background:done?"rgba(16,185,129,0.15)":bg, border:`1px solid ${done?"rgba(16,185,129,0.3)":bdr}`, borderRadius:4, padding:"3px 8px", color:done?"#10b981":sub, cursor:"pointer", whiteSpace:"nowrap" }}>
                        {done ? "✓ Done" : "○ Mark"}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "problemsets" && (
        <div>
          {/* ── Overall PS Progress Bar ── */}
          {(() => {
            const reviewed = sched.problemSets.filter(ps => {
              const r = psReviews[`${course.id}_${ps.id}`]
              return r && r.score != null
            })
            const avgScore = reviewed.length
              ? Math.round(reviewed.reduce((s, ps) => s + (psReviews[`${course.id}_${ps.id}`]?.score || 0), 0) / reviewed.length)
              : null
            const pct = Math.round(reviewed.length / sched.problemSets.length * 100)
            const scoreColor = avgScore >= 80 ? "#10b981" : avgScore >= 60 ? "#C17F3A" : avgScore != null ? "#ef4444" : "#64748b"
            return (
              <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 20px", marginBottom:20 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div>
                    <span style={{ fontSize:13, fontWeight:600, color:txt }}>Problem Set Progress</span>
                    <span style={{ fontSize:12, color:sub, marginLeft:10 }}>{reviewed.length}/{sched.problemSets.length} reviewed</span>
                  </div>
                  {avgScore != null && (
                    <div style={{ textAlign:"right" }}>
                      <span style={{ fontSize:22, fontWeight:800, color:scoreColor, fontFamily:"'JetBrains Mono',monospace" }}>{avgScore}</span>
                      <span style={{ fontSize:11, color:sub }}>/100 avg</span>
                    </div>
                  )}
                </div>
                {/* Segment bar — one block per PS */}
                <div style={{ display:"flex", gap:3, height:10, borderRadius:6, overflow:"hidden" }}>
                  {sched.problemSets.map(ps => {
                    const r = psReviews[`${course.id}_${ps.id}`]
                    const sc = r?.score
                    const col = sc >= 80 ? "#10b981" : sc >= 60 ? "#C17F3A" : sc != null ? "#ef4444" : "rgba(255,255,255,0.08)"
                    return <div key={ps.id} title={`${ps.title}: ${sc != null ? sc+"/100" : "not reviewed"}`} style={{ flex:1, background:col, borderRadius:2, transition:"background 0.4s" }} />
                  })}
                </div>
                <div style={{ display:"flex", gap:16, marginTop:8 }}>
                  {[["#10b981","≥ 80 (Strong)"],["#C17F3A","60–79 (Good)"],["#ef4444","< 60 (Review)"],["rgba(255,255,255,0.15)","Not yet submitted"]].map(([col,label]) => (
                    <div key={label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:col, flexShrink:0 }} />
                      <span style={{ fontSize:10, color:muted }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* ── PS Cards ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {sched.problemSets.map(ps => {
              const reviewKey = `${course.id}_${ps.id}`
              const review = psReviews[reviewKey]
              const isExpanded = expandedPs === ps.id
              const isReviewing = reviewing === ps.id
              const sc = review?.score
              const scoreColor = sc >= 80 ? "#10b981" : sc >= 60 ? "#C17F3A" : sc != null ? "#ef4444" : null
              const grade = review?.grade

              return (
                <div key={ps.id} style={{ background:bg, border:`1px solid ${review?.score!=null ? scoreColor+"40" : isExpanded ? "rgba(193,127,58,0.3)" : bdr}`, borderRadius:14, overflow:"hidden", transition:"border-color 0.3s" }}>

                  {/* Card Header */}
                  <div style={{ padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6, flexWrap:"wrap" }}>
                        <span style={{ fontSize:15, fontWeight:700, color:txt }}>{ps.title}{ps.link && (
  <a href={ps.link} target="_blank" rel="noreferrer"
    style={{ fontSize:11, color:"#C17F3A", textDecoration:"none", marginLeft:10 }}>
    Open PS →
  </a>
)}</span>
                        <span style={{ fontSize:10, color:"#C17F3A", background:"rgba(193,127,58,0.1)", padding:"2px 8px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace" }}>After L{ps.assignedAfter}</span>
                        {review?.submittedAt && (
                          <span style={{ fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>Submitted {review.submittedAt}</span>
                        )}
                      </div>
                      <div style={{ fontSize:12, color:sub, lineHeight:1.5 }}>{ps.covers}</div>
                    </div>

                    {/* Score badge or Submit button */}
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8, flexShrink:0 }}>
                      {sc != null ? (
                        <div style={{ textAlign:"center" }}>
                          <div style={{ fontSize:26, fontWeight:800, color:scoreColor, fontFamily:"'JetBrains Mono',monospace", lineHeight:1 }}>{sc}</div>
                          <div style={{ fontSize:10, color:scoreColor }}>{grade}</div>
                        </div>
                      ) : (
                        <div style={{ width:44, height:44, borderRadius:"50%", border:`2px dashed ${bdr}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <span style={{ fontSize:18, color:muted }}>?</span>
                        </div>
                      )}
                      <div style={{ display:"flex", gap:6 }}>
                        <a href={sched.psPage} target="_blank" rel="noreferrer"
                          style={{ fontSize:11, color:"#C17F3A", textDecoration:"none", border:"1px solid rgba(193,127,58,0.3)", padding:"4px 10px", borderRadius:6 }}>
                          OCW →
                        </a>
                        <button onClick={() => setExpandedPs(isExpanded ? null : ps.id)}
                          style={{ fontSize:11, background:isExpanded?"rgba(193,127,58,0.15)":bg, border:`1px solid ${isExpanded?"rgba(193,127,58,0.4)":bdr}`, borderRadius:6, padding:"4px 12px", color:isExpanded?"#C17F3A":sub, cursor:"pointer" }}>
                          {sc != null ? "✎ Resubmit" : isExpanded ? "✕ Close" : "✦ Submit"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Review result panel */}
                  {review && !isExpanded && sc != null && (
                    <div style={{ borderTop:`1px solid ${bdr}`, padding:"14px 20px" }}>
                      {/* Score breakdown bar */}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:12 }}>
                        {review.breakdown && Object.entries(review.breakdown).map(([key, val]) => {
                          const label = key.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())
                          const pct = Math.round(val / 25 * 100)
                          const col = pct >= 80 ? "#10b981" : pct >= 60 ? "#C17F3A" : "#ef4444"
                          return (
                            <div key={key} style={{ background:T?.rowBg||"rgba(0,0,0,0.025)", borderRadius:8, padding:"10px 12px" }}>
                              <div style={{ fontSize:10, color:muted, marginBottom:4, lineHeight:1.3 }}>{label}</div>
                              <div style={{ fontSize:17, fontWeight:700, color:col, fontFamily:"'JetBrains Mono',monospace" }}>{val}/25</div>
                              <div style={{ height:3, borderRadius:2, background:"rgba(255,255,255,0.06)", marginTop:5, overflow:"hidden" }}>
                                <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:2 }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Summary */}
                      {review.summary && (
                        <div style={{ background:T?.rowBg||"rgba(0,0,0,0.025)", borderRadius:8, padding:"10px 14px", marginBottom:10, fontSize:13, color:sub, lineHeight:1.6, borderLeft:`3px solid ${scoreColor}` }}>
                          {review.summary}
                        </div>
                      )}

                      {/* Strengths + Improvements */}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:10 }}>
                        <div>
                          <div style={{ fontSize:11, color:"#10b981", fontFamily:"'JetBrains Mono',monospace", marginBottom:6, letterSpacing:"0.06em" }}>✓ STRENGTHS</div>
                          {(review.strengths||[]).map((s,i) => (
                            <div key={i} style={{ fontSize:12, color:sub, lineHeight:1.5, marginBottom:4, display:"flex", gap:6 }}>
                              <span style={{ color:"#10b981", flexShrink:0 }}>•</span>{s}
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize:11, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", marginBottom:6, letterSpacing:"0.06em" }}>↑ IMPROVE</div>
                          {(review.improvements||[]).map((s,i) => (
                            <div key={i} style={{ fontSize:12, color:sub, lineHeight:1.5, marginBottom:4, display:"flex", gap:6 }}>
                              <span style={{ color:"#C17F3A", flexShrink:0 }}>•</span>{s}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Hint */}
                      {review.model_answer_hint && (
                        <div style={{ background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#a5b4fc", lineHeight:1.5 }}>
                          💡 <strong>Hint:</strong> {review.model_answer_hint}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Submission panel */}
                  {isExpanded && (
                    <div style={{ borderTop:`1px solid rgba(193,127,58,0.25)`, padding:"16px 20px", background:"rgba(193,127,58,0.03)" }}>
                      <div style={{ fontSize:12, color:sub, marginBottom:10, lineHeight:1.5 }}>
                        Write or paste your solution below. Our AI professor will score it on <strong style={{color:txt}}>Conceptual Understanding</strong>, <strong style={{color:txt}}>Mathematical Rigor</strong>, <strong style={{color:txt}}>Problem Solving</strong>, and <strong style={{color:txt}}>Clarity</strong>.
                      </div>
                      <textarea
                        value={drafts[ps.id] || ""}
                        onChange={e => setDrafts(prev => ({ ...prev, [ps.id]: e.target.value }))}
                        placeholder={`Write your solution to ${ps.title} here...\n\nExample: "For problem 1, I applied the definition of linear independence... Setting up the matrix A = [...], I computed the determinant..."`}
                        rows={10}
                        style={{
                          width:"100%", background:inBg, border:`1px solid rgba(193,127,58,0.25)`,
                          borderRadius:10, padding:"14px 16px", color:txt, fontSize:13,
                          fontFamily:"'DM Sans',sans-serif", lineHeight:1.6, outline:"none",
                          resize:"vertical", marginBottom:12
                        }}
                      />
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:11, color:muted }}>{(drafts[ps.id]||"").length} chars · min ~30 for review</span>
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={() => setExpandedPs(null)}
                            style={{ padding:"8px 16px", borderRadius:8, border:`1px solid ${bdr}`, background:"transparent", color:sub, fontSize:13, cursor:"pointer" }}>
                            Cancel
                          </button>
                          <button
                            onClick={() => submitForReview(ps)}
                            disabled={isReviewing || (drafts[ps.id]||"").trim().length < 30}
                            style={{ padding:"8px 20px", borderRadius:8, border:"none", background: isReviewing ? "rgba(193,127,58,0.3)" : "rgba(193,127,58,0.9)", color:"#000", fontSize:13, fontWeight:700, cursor:"pointer", opacity:(drafts[ps.id]||"").trim().length<30?0.4:1, display:"flex", alignItems:"center", gap:8 }}>
                            {isReviewing ? (
                              <><span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⟳</span> Reviewing...</>
                            ) : "✦ Submit for AI Review"}
                          </button>
                        </div>
                      </div>
                      {review?.error && (
                        <div style={{ marginTop:10, fontSize:12, color:"#ef4444", background:"rgba(239,68,68,0.08)", borderRadius:6, padding:"8px 12px" }}>{review.error}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
        </div>
      )}

      {tab === "resources" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          {[
            { label:"YouTube Playlist", desc:`All ${sched.lectures.length} lectures in order`, url:sched.playlistUrl, icon:"▶", color:"#ef4444" },
            { label:"MIT OCW Page",     desc:"Syllabus, calendar, all materials hub",         url:sched.ocwUrl,      icon:"🎓", color:"#C17F3A" },
            { label:"Lecture Notes",    desc:"Typed/scanned notes as PDFs",                  url:sched.notesPage,   icon:"📄", color:"#0ea5e9" },
            { label:"Problem Sets",     desc:"All assignments with full solutions",           url:sched.psPage,      icon:"📝", color:"#C17F3A" },
          ].map(r => (
            <a key={r.label} href={r.url} target="_blank" rel="noreferrer" style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 18px", textDecoration:"none", display:"block", transition:"border-color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor=`${r.color}50`}
              onMouseLeave={e => e.currentTarget.style.borderColor=bdr}>
              <div style={{ fontSize:24, marginBottom:8 }}>{r.icon}</div>
              <div style={{ fontSize:14, fontWeight:600, color:r.color }}>{r.label} →</div>
              <div style={{ fontSize:12, color:sub, marginTop:4 }}>{r.desc}</div>
            </a>
          ))}
          <div style={{ gridColumn:"1/-1", background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontSize:11, color:sub, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Textbook</div>
            <div style={{ fontSize:14, color:txt }}>{sched.textbook}</div>
          </div>
        </div>
      )}
    </div>
  )
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DATA: TREE_EDGES — natural learning order beyond formal PREREQS
// These encode the *narrative* path a student should follow.
// Format: [fromId, toId] — directed, top→bottom in the tree.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TREE_EDGES = {
  "Mathematics": [
    ["m0","m1"],["m1","m2"],["m0","m3"],["m0","m4"],
    ["m4","m9"],["m3","m6"],["m6","m13"],["m3","m8"],
    ["m3","m12"],["m3","m17"],["m17","m18"],["m3","m26"],
    ["m3","m7"],["m1","m21"],["m21","m23"],["m4","m20"],
    ["m24","m29"],["m24","m20"],
  ],
  "Comp Sci": [
    ["c0","c1"],["c0","c7"],["c3","c4"],["c8","c16"],
    ["c2","c6"],["c2","c20"],["c7","c10"],["c7","c11"],
    ["c8","c15"],["c8","c9"],["c17","c23"],["c18","c23"],
  ],
  "Programming": [
    ["p6","p0"],["p0","p2"],["p2","p1"],["p1","p10"],
    ["p6","p5"],["p5","p14"],["p14","p15"],["p15","p17"],
    ["p4","p5"],["p6","p18"],["p18","p19"],["p6","p20"],
    ["p5","p13"],["p6","p8"],["p8","p9"],["p6","p23"],["p23","p24"],
  ],
  "Machine Learning": [
    ["ml5","ml3"],["ml5","ml4"],["ml5","ml0"],["ml5","ml6"],
    ["ml5","ml7"],["ml3","ml1"],["ml1","ml11"],["ml1","ml12"],
    ["ml1","ml2"],["ml0","ml9"],["ml6","ml7"],
  ],
  "Finance & Economics": [
    ["f3","f4"],["f0","f1"],["f1","f7"],["f1","f9"],
    ["f1","f13"],["f1","f16"],["f16","f17"],["f1","f18"],
    ["f7","f22"],["f8","f21"],["f0","f8"],["f14","f24"],["f14","f25"],
    ["f11","f12"],
  ],
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENT: SkillTreeView — tabbed, one subject at a time
// Arc progress ring · name labels below nodes · side panel · P-A larger nodes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SkillTreeView = ({ courseProgress, onCourseClick, setCourseProgress, T, isDark, aiSettings, githubData = {} }) => {
  const LIVE_COURSES = githubData.courses || COURSES
  const SUBJECTS     = ["Mathematics","Comp Sci","Programming","Machine Learning","Finance & Economics"]
  const [activeSubj, setActiveSubj]   = useState("Mathematics")
  const [panelCourse,setPanelCourse]  = useState(null)
  const [showPA,     setShowPA]       = useState(false)
  const [showPath,   setShowPath]     = useState(false)
  const [isFullscreen,setIsFullscreen]= useState(false)
  const [reviewSchedule, setReviewSchedule] = useStorage("review_schedule_v1", {})
  // reviewSchedule[courseId] = "YYYY-MM-DD" (due date)
  const treeRef = useRef(null)

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      treeRef.current?.requestFullscreen().then(()=>setIsFullscreen(true)).catch(()=>{})
    } else {
      document.exitFullscreen().then(()=>setIsFullscreen(false)).catch(()=>{})
    }
  }
  useEffect(()=>{
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return ()=>document.removeEventListener("fullscreenchange", handler)
  },[])

  // ── Lecture progress 0–1 from stored "done/total" string ────────────────────
  const lecturePct = (course) => {
    if (courseProgress[course.id] === 1) return 1
    const m = String(course.lectures||"").trim().match(/^(\d+)\/(\d+)$/)
    if (m && +m[2]>0) return Math.min(+m[1]/+m[2], 0.999)
    return courseProgress[course.id]===0.5 ? 0.33 : 0
  }

  // ── Node state ────────────────────────────────────────────────────────────────
  const nodeState = (id) => {
    const p = courseProgress[id]
    if (p===1)   return "done"
    if (p===0.5) return "active"
    return (PREREQS[id]||[]).every(d=>courseProgress[d]===1) ? "avail" : "locked"
  }

  // ── Arc path for circular progress ring (clockwise from top) ─────────────────
  const arcPath = (cx, cy, r, pct) => {
    if (pct<=0) return ""
    if (pct>=1) return `M${cx},${cy-r} A${r},${r},0,1,1,${cx-0.001},${cy-r}Z`
    const angle = pct*2*Math.PI - Math.PI/2
    const laf   = pct>0.5 ? 1 : 0
    const ex    = cx + r*Math.cos(angle)
    const ey    = cy + r*Math.sin(angle)
    return `M${cx},${cy-r} A${r},${r},0,${laf},1,${ex},${ey}`
  }

  // ── Layout for the active subject ────────────────────────────────────────────
  const layout = useMemo(() => {
    const subj    = activeSubj
    const col     = SUBJECT_COLORS[subj]
    const allC    = LIVE_COURSES.filter(c => c.subject===subj)
    const ids     = new Set(allC.map(c=>c.id))
    const edges   = (TREE_EDGES[subj]||[]).filter(([a,b])=>ids.has(a)&&ids.has(b))
    const edgeSet = new Set(edges.map(([a,b])=>`${a}→${b}`))

    // Within-subject in-edges and out-edges from TREE_EDGES
    const children = {}, parents = {}
    allC.forEach(c=>{ children[c.id]=[]; parents[c.id]=[] })
    edges.forEach(([a,b])=>{ children[a].push(b); parents[b].push(a) })

    // Connected = has any TREE_EDGES link
    const inTree  = allC.filter(c=>children[c.id].length>0||parents[c.id].length>0)
    const free    = allC.filter(c=>children[c.id].length===0&&parents[c.id].length===0)

    // Topological depth
    const depth = {}
    const visit=(id,seen=new Set())=>{
      if(id in depth) return depth[id]
      if(seen.has(id)) return 0
      seen.add(id)
      depth[id] = parents[id].length===0 ? 0 : Math.max(...parents[id].map(p=>visit(p,new Set(seen))))+1
      return depth[id]
    }
    inTree.forEach(c=>visit(c.id))

    // Group by depth, sort by P-A first within each level
    const maxD = inTree.length>0 ? Math.max(...inTree.map(c=>depth[c.id])) : -1
    const byLevel = Array.from({length:maxD+1},()=>[])
    inTree.forEach(c=>byLevel[depth[c.id]].push(c))
    byLevel.forEach(lvl=>lvl.sort((a,b)=>(a.priority==="A"?0:1)-(b.priority==="A"?0:1)))

    // SVG sizing
    const nodeR    = (c) => c.priority==="A" ? 30 : c.priority==="B" ? 24 : 20
    const H_SEP    = 72   // horizontal gap between node centres in a row
    const V_SEP    = 110  // vertical gap between depth levels
    const PAD_TOP  = 28
    const svgW_min = 700

    // Compute x per node: distribute evenly per level, centred on svgW
    const positions = {}
    const maxNodesInRow = Math.max(...byLevel.map(l=>l.length),1)
    const svgW = Math.max(svgW_min, maxNodesInRow*H_SEP + 120)

    byLevel.forEach((nodes,d)=>{
      const total = nodes.length
      const rowW  = (total-1)*H_SEP
      const startX= svgW/2 - rowW/2
      nodes.forEach((c,i)=>{
        const r = nodeR(c)
        positions[c.id]={ x:startX+i*H_SEP, y:PAD_TOP+d*V_SEP+r, r, free:false }
      })
    })

    // Free nodes in compact grid at bottom
    const treeH   = PAD_TOP + (maxD+1)*V_SEP + 40
    const FREE_COLS = Math.max(Math.floor((svgW-48) / 90), 3)
    free.forEach((c,i)=>{
      const fr=16
      positions[c.id]={
        x: 40 + (i%FREE_COLS)*90 + fr,
        y: treeH + 36 + Math.floor(i/FREE_COLS)*88 + fr,
        r: fr, free:true
      }
    })

    const freeRows = free.length>0 ? Math.ceil(free.length/FREE_COLS) : 0
    const svgH     = treeH + (freeRows>0 ? 36+freeRows*88+32 : 0) + 32

    // "My path" highlight: ancestors+descendants of the deepest active/done node
    const pathSet = new Set()
    if(showPath){
      const active = inTree.filter(c=>["done","active"].includes(nodeState(c.id)))
      const deepest= active.sort((a,b)=>(depth[b.id]||0)-(depth[a.id]||0))[0]
      if(deepest){
        const up=(id)=>{ pathSet.add(id); parents[id].forEach(up) }
        const dn=(id)=>{ pathSet.add(id); children[id].forEach(dn) }
        up(deepest.id); dn(deepest.id)
      }
    }

    return { col, allC, inTree, free, depth, byLevel, children, parents, edges,
             positions, svgW, svgH, treeH, FREE_COLS, pathSet }
  },[activeSubj, courseProgress, showPath])

  // ── Cycle course status on right-click (from tree) ───────────────────────────
  const cycleStatus = (e, id) => {
    e.preventDefault()
    setCourseProgress(prev=>{
      const curr=prev[id]
      const next=curr===1?0:curr===0.5?1:0.5
      return {...prev,[id]:next}
    })
  }

  // ── Filtered courses list (respects showPA) ───────────────────────────────────
  const visibleIds = useMemo(()=>{
    if(!showPA) return new Set(layout.allC.map(c=>c.id))
    return new Set(layout.allC.filter(c=>c.priority==="A").map(c=>c.id))
  },[layout, showPA])

  const { col, allC, inTree, free, positions, svgW, svgH, treeH, edges,
          children, parents, pathSet } = layout

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div ref={treeRef} style={{display:"flex",gap:0,borderRadius:18,overflow:"hidden",
      background:"linear-gradient(160deg,#05050d 0%,#090916 60%,#06060f 100%)",
      boxShadow:"0 0 0 1px rgba(255,255,255,0.05) inset, 0 32px 80px rgba(0,0,0,0.6)",
      minHeight:500, position:"relative"}}>

      {/* ── Left: tree panel ── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>

        {/* Controls bar */}
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"14px 20px 10px",
          flexWrap:"wrap",borderBottom:"none",
          background:T?.rowBg||"rgba(0,0,0,0.025)"}}>

          {/* Subject tabs */}
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {SUBJECTS.map(s=>{
              const c=SUBJECT_COLORS[s]
              const active=activeSubj===s
              return (
                <button key={s} onClick={()=>{ setActiveSubj(s); setPanelCourse(null) }}
                  style={{padding:"5px 13px",borderRadius:20,border:`1px solid ${active?c:c+"30"}`,
                    fontSize:10,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
                    fontWeight:active?700:400,letterSpacing:"0.06em",
                    background:active?`${c}20`:"transparent",
                    color:active?c:`${c}80`,transition:"all 0.15s"}}>
                  {s}
                </button>
              )
            })}
          </div>

          {/* Separator */}
          <div style={{width:1,height:20,background:"rgba(255,255,255,0.06)",flexShrink:0}}/>

          {/* Filters */}
          <button onClick={()=>setShowPA(v=>!v)}
            style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${showPA?"#C17F3A":"rgba(193,127,58,0.2)"}`,
              fontSize:10,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
              background:showPA?"rgba(193,127,58,0.15)":"transparent",
              color:showPA?"#C17F3A":"rgba(193,127,58,0.5)",transition:"all 0.15s"}}>
            ★ Priority A only
          </button>
          <button onClick={()=>setShowPath(v=>!v)}
            style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${showPath?"#6366f1":"rgba(99,102,241,0.2)"}`,
              fontSize:10,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
              background:showPath?"rgba(99,102,241,0.15)":"transparent",
              color:showPath?"#818cf8":"rgba(99,102,241,0.5)",transition:"all 0.15s"}}>
            ⬡ My path
          </button>

          {/* Fullscreen toggle */}
          <button onClick={toggleFullscreen}
            title={isFullscreen?"Exit fullscreen":"Fullscreen"}
            style={{padding:"5px 10px",borderRadius:20,border:`1px solid ${T?.border||"rgba(0,0,0,0.08)"}`,
              fontSize:11,cursor:"pointer",background:T?.cardBg||"rgba(255,255,255,0.7)",
              color:"rgba(255,255,255,0.3)",transition:"all 0.15s",lineHeight:1}}>
            {isFullscreen ? "⊠" : "⊡"}
          </button>

          {/* Legend */}
          <div style={{marginLeft:"auto",display:"flex",gap:12,alignItems:"center",
            fontSize:9,fontFamily:"'JetBrains Mono',monospace",color:"#1e3048",flexWrap:"wrap"}}>
            {[["#10b981","Done"],["#C17F3A","Active"],["#94a3b8","Ready"],["#1e293b","Locked"]].map(([c,l])=>(
              <span key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:c,display:"inline-block"}}/>
                {l}
              </span>
            ))}
            <span style={{color:"#12172a"}}>Right-click node to toggle status</span>
          </div>
        </div>

        {/* SVG canvas */}
        <div style={{overflowY:"auto",overflowX:"auto",flex:1,
          maxHeight:isFullscreen?"calc(100vh - 60px)":"68vh",padding:"0 10px 10px"}}>
          <svg width={svgW} height={svgH} style={{display:"block",overflow:"visible"}}>
            <defs>
              <filter id="nd-done" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="nd-active" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="nd-hover" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>

            {/* ── Standalone separator ── */}
            {free.length>0 && (
              <g>
                <line x1={24} y1={treeH+2} x2={svgW-24} y2={treeH+2}
                  stroke={`${col}18`} strokeWidth={1} strokeDasharray="4 6"/>
                <text x={28} y={treeH+18} fontSize={8} fill={`${col}44`}
                  fontFamily="'JetBrains Mono',monospace" letterSpacing="0.1em">
                  ◦ STANDALONE COURSES (no natural chain)
                </text>
              </g>
            )}

            {/* ── Edges ── */}
            {edges.map(([aid,bid])=>{
              const a=positions[aid], b=positions[bid]
              if(!a||!b) return null
              if(showPA && (!visibleIds.has(aid)||!visibleIds.has(bid))) return null
              const lit  = courseProgress[aid]===1
              const dim  = showPath && pathSet.size>0 && (!pathSet.has(aid)||!pathSet.has(bid))
              const x1=a.x, y1=a.y+a.r+2, x2=b.x, y2=b.y-b.r-2
              const my=(y1+y2)/2
              return (
                <path key={`${aid}→${bid}`}
                  d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                  fill="none"
                  stroke={lit?"#10b981":"#1a2540"}
                  strokeWidth={lit?2:1}
                  opacity={dim?0.08:lit?0.9:0.55}
                />
              )
            })}

            {/* ── Nodes ── */}
            {allC.map(course=>{
              const p   = positions[course.id]; if(!p) return null
              if(showPA && !visibleIds.has(course.id)) return null

              const state   = nodeState(course.id)
              const pct     = lecturePct(course)
              const locked  = state==="locked"
              const r       = p.r
              const isPanel = panelCourse?.id===course.id
              const dimPath = showPath && pathSet.size>0 && !pathSet.has(course.id) && !p.free
              const hasSched= !!SCHEDULES[course.id]

              // Colours
              const nodeBg  = state==="done"  ? "#10b981"
                            : state==="active" ? "#071c14"
                            : locked           ? "#080d18"
                            : "#0e1626"
              const ringC   = state==="done"  ? "#34d399"
                            : state==="active" ? "#10b981"
                            : locked           ? "#111e33"
                            : `${col}55`
              const labelC  = state==="done"  ? "#fff"
                            : locked           ? "#1a2e48"
                            : "#c8d4e8"
              const arcC    = state==="done"  ? "#34d399"
                            : state==="active" ? "#C17F3A"
                            : col
              const glowF   = state==="done"  ? "url(#nd-done)"
                            : state==="active" ? "url(#nd-active)"
                            : isPanel          ? "url(#nd-hover)"
                            : "none"
              const opacity = locked ? 0.4 : dimPath ? 0.15 : 1

              // Short label: order number in its level if connected, else acronym
              const levelIdx= (inTree.includes(course) && layout.byLevel)
                ? layout.byLevel[layout.depth?.[course.id]||0]?.indexOf(course)+1 || "?"
                : "·"
              const insideLabel = state==="done" ? "✓" : p.free ? "" : String(levelIdx)

              // Name label below node (2 words max)
              const words = course.name.split(" ")
              const line1 = words.slice(0,2).join(" ")
              const line2 = words.length>2 ? words.slice(2,4).join(" ")+(words.length>4?"…":"") : null

              // Arc ring params
              const arcR  = r+4
              const ringPct = pct
              const arcD  = arcPath(p.x, p.y, arcR, ringPct)

              return (
                <g key={course.id}
                  style={{cursor:"pointer"}}
                  onClick={()=>setPanelCourse(prev=>prev?.id===course.id?null:course)}
                  onContextMenu={e=>{ e.preventDefault(); if(!locked) cycleStatus(e,course.id) }}>

                  {/* ── Transparent hit-area (ensures full circle is always clickable) ── */}
                  <circle cx={p.x} cy={p.y} r={r+8} fill="transparent"/>

                  <g style={{opacity, transition:"opacity 0.2s"}}>
                    {/* Outer selected ring */}
                    {isPanel && <circle cx={p.x} cy={p.y} r={r+9}
                      fill="none" stroke={col} strokeWidth={1.5} opacity={0.5}/>}

                    {/* Subject ambient ring */}
                    <circle cx={p.x} cy={p.y} r={r+2}
                      fill="none" stroke={col} strokeWidth={0.4}
                      opacity={locked?0.05:0.18}/>

                    {/* Node body */}
                    <circle cx={p.x} cy={p.y} r={r}
                      fill={nodeBg} stroke={ringC} strokeWidth={isPanel?2:1}
                      filter={glowF}/>

                    {/* Arc progress ring */}
                    {arcD && ringPct>0 && (
                      <path d={arcD} fill="none"
                        stroke={arcC} strokeWidth={3}
                        strokeLinecap="round" opacity={0.95}/>
                    )}

                    {/* Order number label */}
                    <text x={p.x} y={p.y+0.5} textAnchor="middle" dominantBaseline="middle"
                      fontSize={p.free?7:r>26?12:10} fontWeight={700} fill={labelC}
                      fontFamily="'JetBrains Mono',monospace" style={{pointerEvents:"none"}}>
                      {insideLabel}
                    </text>

                    {/* Schedule dot */}
                    {hasSched && !locked && (
                      <circle cx={p.x+r-5} cy={p.y-r+5} r={3}
                        fill="#6366f1" stroke="#818cf8" strokeWidth={1}/>
                    )}

                    {/* Name label below node — shown for all nodes */}
                    <text x={p.x} y={p.y+r+12} textAnchor="middle"
                      fontSize={p.free?7:8} fill={locked?"#1a2e48":isPanel?col:"#4a6280"}
                      fontFamily="'DM Sans',sans-serif" fontWeight={isPanel?600:400}
                      style={{pointerEvents:"none"}}>
                      {line1}
                    </text>
                    {line2&&<text x={p.x} y={p.y+r+(p.free?19:22)} textAnchor="middle"
                      fontSize={p.free?7:8} fill={locked?"#1a2e48":"#364d66"}
                      fontFamily="'DM Sans',sans-serif" style={{pointerEvents:"none"}}>
                      {line2}
                    </text>}
                  </g>
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* ── Right: side panel ── */}
      {panelCourse && (()=>{
        const c      = panelCourse
        const state  = nodeState(c.id)
        const locked = state === "locked"
        const pct    = lecturePct(c)
        const col2  = SUBJECT_COLORS[c.subject]
        const deps  = (PREREQS[c.id]||[]).map(id=>LIVE_COURSES.find(x=>x.id===id)).filter(Boolean)
        const unlocks=(TREE_EDGES[c.subject]||[]).filter(([a])=>a===c.id)
          .map(([,b])=>LIVE_COURSES.find(x=>x.id===b)).filter(Boolean)
        const hasSched=!!SCHEDULES[c.id]
        const statusIcon=state==="done"?"✓ Done":state==="active"?"◑ In Progress":state==="avail"?"○ Ready":"🔒 Locked"
        const statusC=state==="done"?"#10b981":state==="active"?"#C17F3A":state==="avail"?"#94a3b8":"#334155"

        return (
          <div style={{
            width:280,flexShrink:0,
            background:T?.panelBg||"rgba(255,255,255,0.9)",
            borderLeft:"none",
            boxShadow:isDark?"-12px 0 40px rgba(0,0,0,0.4)":"-12px 0 40px rgba(0,0,0,0.08)",
            display:"flex",flexDirection:"column",
            overflowY:"auto",
            animation:"qos-fade 0.18s ease",
          }}>
            {/* Header */}
            <div style={{padding:"20px 20px 16px",borderBottom:"none",
              background:`linear-gradient(180deg,${col2}12 0%,transparent 100%)`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:8,color:col2,fontFamily:"'JetBrains Mono',monospace",
                    letterSpacing:"0.12em",marginBottom:4}}>{c.subject.toUpperCase()}</div>
                  <div style={{fontSize:14,fontWeight:700,color:T?.panelText||"#1a1a2e",lineHeight:1.35,
                    fontFamily:"'Syne',sans-serif"}}>{c.name}</div>
                  <div style={{fontSize:10,color:T?.panelMuted||"#64748b",marginTop:4}}>{c.institution}</div>
                </div>
                <button onClick={()=>setPanelCourse(null)}
                  style={{background:"none",border:"none",color:T?.panelMuted||"#64748b",cursor:"pointer",
                    fontSize:16,lineHeight:1,flexShrink:0,paddingTop:2}}>✕</button>
              </div>

              {/* Status + progress */}
              <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:10,color:statusC,fontFamily:"'JetBrains Mono',monospace",
                    fontWeight:700}}>{statusIcon}</span>
                  <span style={{fontSize:9,color:T?.panelMuted||"#64748b",fontFamily:"'JetBrains Mono',monospace"}}>
                    {c.priority==="A"?"★ Priority A":c.priority==="B"?"Priority B":"Priority C"}
                  </span>
                </div>
                {/* Arc progress bar */}
                <div style={{height:3,borderRadius:3,background:T?.trackBg||"rgba(0,0,0,0.08)",overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:3,
                    background:state==="done"?"#10b981":state==="active"?`linear-gradient(90deg,#10b981,#C17F3A)`:col2,
                    width:`${Math.round(pct*100)}%`,transition:"width 0.5s ease"}}/>
                </div>
                <div style={{fontSize:9,color:"#1e3048",fontFamily:"'JetBrains Mono',monospace"}}>
                  {Math.round(pct*100)}% lectures complete · {c.lectures}
                </div>
              </div>
            </div>

            {/* Body */}
            <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:14,flex:1}}>

              {/* Locked explanation */}
              {state==="locked" && deps.filter(d=>nodeState(d.id)!=="done").length>0 && (
                <div style={{padding:"10px 12px",borderRadius:9,
                  background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.15)"}}>
                  <div style={{fontSize:9,color:"#ef4444",fontFamily:"'JetBrains Mono',monospace",
                    letterSpacing:"0.1em",marginBottom:6}}>🔒 COMPLETE FIRST</div>
                  {deps.filter(d=>nodeState(d.id)!=="done").map(d=>(
                    <div key={d.id} onClick={()=>setPanelCourse(d)}
                      style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",
                        borderRadius:6,marginBottom:3,cursor:"pointer",
                        background:"rgba(239,68,68,0.04)"}}>
                      <span style={{fontSize:10,color:"#ef4444"}}>○</span>
                      <span style={{fontSize:11,color:"#4a6280",lineHeight:1.3}}>{d.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick actions */}
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>!locked && onCourseClick(c)}
                  style={{flex:1,padding:"7px 0",borderRadius:8,
                    border:`1px solid ${locked?T?.rowBorder||"rgba(0,0,0,0.06)":col2+"35"}`,
                    background:locked?T?.rowBg||"rgba(0,0,0,0.025)":`${col2}12`,
                    color:locked?"#1e3048":col2,
                    fontSize:11,cursor:locked?"default":"pointer",fontWeight:600,
                    opacity:locked?0.5:1}}>
                  {locked?"🔒 Locked":hasSched?"📋 Open Schedule":"→ Open Course"}
                </button>
                <button onClick={e=>{ if(!locked||state==="avail") cycleStatus(e,c.id) }}
                  style={{flex:1,padding:"7px 0",borderRadius:8,
                    border:`1px solid ${statusC}35`,background:`${statusC}10`,
                    color:statusC,fontSize:11,cursor:locked?"default":"pointer",fontWeight:600,
                    opacity:locked?0.4:1}}>
                  {state==="done"?"↩ Undo":state==="active"?"✓ Mark Done":state==="avail"?"▶ Start":"—"}
                </button>
              </div>

              {/* Prerequisites */}
              {deps.length>0 && (
                <div>
                  <div style={{fontSize:9,color:"#1e3048",fontFamily:"'JetBrains Mono',monospace",
                    letterSpacing:"0.1em",marginBottom:8}}>PREREQUISITES</div>
                  {deps.map(d=>{
                    const ds=nodeState(d.id)
                    return (
                      <div key={d.id} onClick={()=>setPanelCourse(d)}
                        style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",
                          borderRadius:7,background:T?.rowBg||"rgba(0,0,0,0.02)",marginBottom:4,
                          cursor:"pointer",border:`1px solid ${T?.rowBorder||"rgba(0,0,0,0.05)"}`}}>
                        <span style={{fontSize:10,
                          color:ds==="done"?"#10b981":ds==="active"?"#C17F3A":"#334155"}}>
                          {ds==="done"?"✓":ds==="active"?"◑":"○"}
                        </span>
                        <span style={{fontSize:11,color:"#4a6280",lineHeight:1.3}}>{d.name}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Unlocks next */}
              {unlocks.length>0 && (
                <div>
                  <div style={{fontSize:9,color:"#1e3048",fontFamily:"'JetBrains Mono',monospace",
                    letterSpacing:"0.1em",marginBottom:8}}>UNLOCKS NEXT</div>
                  {unlocks.map(d=>(
                    <div key={d.id} onClick={()=>setPanelCourse(d)}
                      style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",
                        borderRadius:7,background:T?.rowBg||"rgba(0,0,0,0.02)",marginBottom:4,
                        cursor:"pointer",border:`1px solid ${T?.rowBorder||"rgba(0,0,0,0.05)"}`}}>
                      <span style={{fontSize:10,color:col2}}>→</span>
                      <span style={{fontSize:11,color:"#4a6280",lineHeight:1.3}}>{d.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Revision schedule */}
              {(state === "done" || state === "active") && (() => {
                const due = reviewSchedule[c.id]
                const daysLeft = due ? Math.ceil((new Date(due) - new Date()) / 86400000) : null
                const isDue = daysLeft !== null && daysLeft <= 0
                return (
                  <div style={{padding:"10px 12px",borderRadius:9,
                    background:isDue?"rgba(239,68,68,0.06)":due?"rgba(99,102,241,0.06)":T?.rowBg||"rgba(0,0,0,0.025)",
                    border:`1px solid ${isDue?"rgba(239,68,68,0.2)":due?"rgba(99,102,241,0.15)":T?.rowBorder||"rgba(0,0,0,0.06)"}`}}>
                    <div style={{fontSize:9,color:isDue?"#ef4444":"#818cf8",fontFamily:"'JetBrains Mono',monospace",
                      letterSpacing:"0.1em",marginBottom:8}}>
                      {isDue?"🔔 REVIEW DUE":due?"⏰ REVIEW SCHEDULED":"🗓 REVISION SCHEDULE"}
                    </div>
                    {due ? (
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                        <span style={{fontSize:11,color:isDue?"#ef4444":"#94a3b8"}}>
                          {isDue?`Overdue by ${Math.abs(daysLeft)}d`:`Due in ${daysLeft}d — ${new Date(due).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}`}
                        </span>
                        <button onClick={()=>setReviewSchedule(p=>{const n={...p};delete n[c.id];return n})}
                          style={{fontSize:10,color:"#475569",background:"none",border:"none",cursor:"pointer",padding:0}}>
                          ✕ clear
                        </button>
                      </div>
                    ) : (
                      <div style={{display:"flex",gap:6}}>
                        {[7,14,30].map(days=>(
                          <button key={days} onClick={()=>{
                            const d=new Date(); d.setDate(d.getDate()+days)
                            setReviewSchedule(p=>({...p,[c.id]:d.toISOString().slice(0,10)}))
                          }} style={{flex:1,padding:"5px 0",borderRadius:7,fontSize:10,cursor:"pointer",
                            border:"1px solid rgba(99,102,241,0.2)",
                            background:"rgba(99,102,241,0.08)",color:"#818cf8",fontFamily:"'JetBrains Mono',monospace"}}>
                            +{days}d
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* External link */}
              {c.link&&c.link.startsWith("http")&&(
                <a href={c.link} target="_blank" rel="noreferrer"
                  style={{display:"block",textAlign:"center",padding:"7px",borderRadius:8,
                    border:`1px solid ${T?.border||"rgba(0,0,0,0.07)"}`,color:T?.textSub||"#64748b",fontSize:11,
                    textDecoration:"none",background:T?.rowBg||"rgba(0,0,0,0.02)"}}>
                  ↗ Open on {c.source}
                </a>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/components/modules/LearningPath.jsx  (when splitting into separate files)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const LearningPath = ({ courseProgress, setCourseProgress, T, user, aiSettings, githubData = {}, markStudyToday = ()=>{} }) => {
  const LIVE_COURSES = githubData.courses || COURSES
  const [activeSubj, setActiveSubj] = useState("All")
  const [filterStatus, setFilterStatus] = useState("All")
  const [filterPriority, setFilterPriority] = useState("All")
  const [search, setSearch] = useState("")
  const [selectedCourse, setSelectedCourse] = useState(null)
  const [lectureProgress, setLectureProgress] = useStorage("lecture_progress_v2", {})
  const [viewMode, setViewMode] = useState("grid")  // "grid" | "tree"

  const txt    = T?.text      || "#f1f5f9"
  const sub    = T?.textSub   || "#64748b"
  const muted  = T?.textMuted || "#475569"
  const bg     = T?.cardBg    || "rgba(255,255,255,0.04)"
  const bdr    = T?.cardBorder|| "rgba(255,255,255,0.08)"
  const inBg   = T?.inputBg   || "rgba(255,255,255,0.055)"
  const isDark = (T?.text || "#f1f5f9").startsWith("#f") || (T?.text || "").startsWith("#e")

  const subjects = ["All", ...Object.keys(SUBJECT_COLORS)]

  const filtered = LIVE_COURSES.filter(c => {
    if (activeSubj !== "All" && c.subject !== activeSubj) return false
    const status = courseProgress[c.id]
    if (filterStatus === "Done" && status !== 1) return false
    if (filterStatus === "In Progress" && status !== 0.5) return false
    if (filterStatus === "Not Started" && status && status !== 0) return false
    if (filterStatus === "Ready" && !prereqsDone(c.id, courseProgress)) return false
    if (filterStatus === "Locked" && prereqsDone(c.id, courseProgress)) return false
    if (filterPriority !== "All" && c.priority !== filterPriority) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.code.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Write today's date to study log whenever user interacts with a course
  const [studyLog, setStudyLog] = useStorage("study_log_v1", {})

  const toggle = (id) => {
    markStudyToday()
    setCourseProgress(prev => {
      const curr = prev[id]
      const next = curr === 1 ? 0.5 : curr === 0.5 ? 0 : 1
      return { ...prev, [id]: next }
    })
  }

  // Prereq helpers
  const prereqsDone = (courseId, progress) => {
    const deps = PREREQS[courseId] || []
    return deps.every(depId => progress[depId] === 1)
  }
  const hasPrereqs = (courseId) => (PREREQS[courseId] || []).length > 0

  const getStatusLabel = (id) => {
    const s = courseProgress[id]
    if (s === 1) return { label:"✓ Done", color:"#10b981" }
    if (s === 0.5) return { label:"◑ Active", color:"#C17F3A" }
    return { label:"○ Start", color:muted }
  }

  // Drill into CourseDetail
  if (selectedCourse) return (
    <CourseDetail
     course={selectedCourse}
      onBack={() => setSelectedCourse(null)}
      lectureProgress={lectureProgress}
      setLectureProgress={setLectureProgress}
      setCourseProgress={setCourseProgress}
      T={T}
      user={user}
      markStudyToday={markStudyToday}
      githubData={githubData}
    />
  )

  return (
    <div>
      <div style={{ marginBottom:24 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
          <div>
            <h1 style={{ fontSize:26, fontWeight:700, color:txt, fontFamily:"'Syne', sans-serif", margin:0 }}>Learning Path</h1>
            <p style={{ color:sub, margin:"4px 0 0", fontSize:13 }}>{LIVE_COURSES.length} courses · <span style={{ color:"#818cf8" }}>📋 courses with full schedules</span> open lecture-by-lecture view</p>
          </div>
          {/* View toggle */}
          <div style={{ display:"flex", gap:6, flexShrink:0 }}>
            {[["grid","▦ List"],["tree","skilltree"]].map(([mode, label]) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                style={{ padding:"7px 14px", borderRadius:8, border:"1px solid", fontSize:12, cursor:"pointer",
                  fontFamily:"'JetBrains Mono',monospace", transition:"all 0.18s",
                  display:"flex", alignItems:"center", gap:6,
                  borderColor: viewMode === mode ? "#6366f1" : bdr,
                  background:  viewMode === mode ? "rgba(99,102,241,0.15)" : "transparent",
                  color:       viewMode === mode ? "#818cf8" : muted }}>
                {mode === "tree"
                  ? <><NavIcon id="skilltree" size={14} color={viewMode === "tree" ? "#818cf8" : muted}/> Tree</>
                  : label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── TREE VIEW ── */}
      {viewMode === "tree" && (
        <div>
          <div style={{ fontSize:12, color:sub, marginBottom:14, lineHeight:1.7 }}>
            Each node is a course. Edges trace prerequisite chains. <span style={{ color:"#10b981" }}>Green</span> = done · <span style={{ color:"#C17F3A" }}>Amber</span> = in progress · <span style={{ color:"#e2e8f0" }}>White</span> = ready · <span style={{ color:"#334155" }}>Dim</span> = locked. <span style={{ color:"#818cf8" }}>● Indigo dot</span> = full lecture schedule available.
          </div>
          <SkillTreeView
            courseProgress={courseProgress}
            onCourseClick={(c) => setSelectedCourse(c)}
            setCourseProgress={setCourseProgress}
            T={T} isDark={isDark} aiSettings={aiSettings} githubData={githubData}
          />
        </div>
      )}

      {/* ── GRID VIEW ── */}
      {viewMode === "grid" && (<>
        {/* Subject Tabs */}
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
          {subjects.map(s => (
            <button key={s} onClick={() => setActiveSubj(s)} style={{ padding:"6px 14px", borderRadius:20, border:"1px solid", fontSize:12, cursor:"pointer", fontFamily:"'JetBrains Mono', monospace", transition:"all 0.2s",
              borderColor: activeSubj === s ? (SUBJECT_COLORS[s] || "#6366f1") : bdr,
              background: activeSubj === s ? (SUBJECT_COLORS[s] ? SUBJECT_COLORS[s] + "20" : "rgba(99,102,241,0.15)") : "transparent",
              color: activeSubj === s ? (SUBJECT_COLORS[s] || "#6366f1") : sub }}>
              {s}
            </button>
          ))}
        </div>

        {/* Filters Row */}
        <div style={{ display:"flex", gap:10, marginBottom:20, alignItems:"center", flexWrap:"wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search courses..." style={{ background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"7px 12px", color:txt, fontSize:13, outline:"none", minWidth:200 }} />
          {["All","Done","In Progress","Not Started","Ready","Locked"].map(f => (
            <button key={f} onClick={() => setFilterStatus(f)} style={{ padding:"6px 12px", borderRadius:6, border:"1px solid", fontSize:12, cursor:"pointer",
              borderColor: filterStatus === f ? "#6366f1" : bdr,
              background: filterStatus === f ? "rgba(99,102,241,0.15)" : "transparent",
              color: filterStatus === f ? "#818cf8" : sub }}>{f}</button>
          ))}
          {["All","A","B"].map(p => (
            <button key={p} onClick={() => setFilterPriority(p)} style={{ padding:"6px 12px", borderRadius:6, border:"1px solid", fontSize:12, cursor:"pointer",
              borderColor: filterPriority === p ? "#C17F3A" : bdr,
              background: filterPriority === p ? "rgba(193,127,58,0.15)" : "transparent",
              color: filterPriority === p ? "#C17F3A" : sub }}>P-{p}</button>
          ))}
          <span style={{ fontSize:12, color:muted, marginLeft:"auto" }}>{filtered.length} courses</span>
        </div>

        {/* Course Grid */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:12 }}>
          {filtered.map(c => {
            const { label, color } = getStatusLabel(c.id)
            const subjColor = SUBJECT_COLOR_LOOKUP[c.subject] || "#64748b"
            const hasSched = !!SCHEDULES[c.id]
            return (
              <div key={c.id} style={{ background:bg, border:`1px solid ${hasSched ? "rgba(99,102,241,0.22)" : bdr}`, borderRadius:10, padding:"14px 16px", display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <span style={{ fontSize:10, color:subjColor, fontFamily:"'JetBrains Mono', monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>{c.subject}</span>
                    <button onClick={() => setSelectedCourse(c)} style={{ display:"block", fontSize:14, fontWeight:600, color:hasSched ? "#818cf8" : txt, marginTop:2, lineHeight:1.3, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"left" }}>
                      {hasSched && <span style={{ fontSize:10, color:"#6366f1", marginRight:4 }}>📋</span>}
                      {c.name}
                    </button>
                    <div style={{ fontSize:11, color:sub, marginTop:2 }}>{c.institution} · {c.source}</div>
                    {(PREREQS[c.id] || []).length > 0 && (
                      <div style={{ marginTop:4, display:"flex", gap:4, flexWrap:"wrap" }}>
                        {prereqsDone(c.id, courseProgress)
                          ? <span style={{ fontSize:9, color:"#10b981", background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.2)", padding:"1px 6px", borderRadius:3 }}>✓ prereqs done</span>
                          : (PREREQS[c.id]||[]).slice(0,2).map(depId => {
                              const dep = LIVE_COURSES.find(x => x.id === depId)
                              return dep ? <span key={depId} style={{ fontSize:9, color:"#C17F3A", background:"rgba(193,127,58,0.08)", border:"1px solid rgba(193,127,58,0.2)", padding:"1px 6px", borderRadius:3 }}>🔒 {dep.code}</span> : null
                            })
                        }
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize:10, color: c.priority === "A" ? "#C17F3A" : sub, border:"1px solid", borderColor: c.priority === "A" ? "rgba(193,127,58,0.3)" : "rgba(100,116,139,0.2)", padding:"2px 6px", borderRadius:4, whiteSpace:"nowrap" }}>P-{c.priority}</span>
                </div>

                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:11, color:sub, fontFamily:"'JetBrains Mono', monospace" }}>📹 {c.lectures}</span>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    {c.link && c.link.startsWith("http") && (
                      <a href={c.link} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#6366f1", textDecoration:"none" }}>Course →</a>
                    )}
                    <button onClick={() => toggle(c.id)} style={{ fontSize:11, color, background:"transparent", border:`1px solid ${color}30`, padding:"3px 10px", borderRadius:4, cursor:"pointer", fontFamily:"'JetBrains Mono', monospace" }}>
                      {label}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </>)}
    </div>
  )
}

// ─────────────────────────────────────────────
//  MODULE: COMPETITION TRACKER
// ─────────────────────────────────────────────


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/components/modules/CompetitionTracker.jsx  (when splitting)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CompetitionTracker = ({ bookmarks, setBookmarks, T, aiSettings, githubData = {} }) => {
  const LIVE_COMPS = githubData.competitions || COMPETITIONS
  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState("All")
  const [filterCat, setFilterCat] = useState("All")
  const [filterMode, setFilterMode] = useState("All")
  const [sortBy, setSortBy] = useState("deadline")
  const [liveResults, setLiveResults] = useState([])
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveQuery, setLiveQuery] = useState("")
  const [liveError, setLiveError] = useState("")
  const [showLive, setShowLive] = useState(false)
  const [mainTab, setMainTab]   = useState("competitions")

  const [compNotes,    setCompNotes]      = useStorage("comp_notes_v1", {})
  const [openNotes,    setOpenNotes]      = useState({})

  const bg   = T?.cardBg    || "rgba(255,255,255,0.02)"
  const bdr  = T?.cardBorder|| "rgba(255,255,255,0.07)"
  const txt  = T?.text      || "#f1f5f9"
  const sub  = T?.textSub   || "#64748b"
  const muted= T?.textMuted || "#475569"
  const inBg = T?.inputBg   || "rgba(255,255,255,0.04)"
  const selBg= T?.selectBg  || "#111120"

  const categories = ["All", ...Array.from(new Set(COMPETITIONS.map(c => c.category))).sort()]
  const modes = ["All","Online","In-Person","Hybrid"]

  const exportICS = () => {
    const toICSDate = (str) => {
      if (!str || str.includes("TBA")) return null
      const d = new Date(str); if (isNaN(d)) return null
      return d.toISOString().replace(/-|:|\.\d{3}/g,"").slice(0,15)+"Z"
    }
    const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//QuantOS//Competitions//EN","CALSCALE:GREGORIAN"]
    LIVE_COMPS.filter(c=>c.status!=="closed").forEach(c=>{
      const dt = toICSDate(c.deadline); if(!dt) return
      lines.push("BEGIN:VEVENT",
        `DTSTART:${dt}`, `DTEND:${dt}`,
        `SUMMARY:DEADLINE: ${c.name}`,
        `DESCRIPTION:${c.desc?.replace(/\n/g,"\\n")||""} | ${c.link||""}`,
        `URL:${c.link||""}`,
        `LOCATION:${c.location||""}`,
        `UID:quantos-${c.id}@competitions`,
        "END:VEVENT")
    })
    lines.push("END:VCALENDAR")
    const blob = new Blob([lines.join("\r\n")],{type:"text/calendar"})
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob)
    a.download="QuantOS_Competitions_2026.ics"; a.click(); URL.revokeObjectURL(a.href)
  }

  const toggleBookmark = (id) => {
    setBookmarks(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id])
  }

  let filtered = LIVE_COMPS.filter(c => {
    if (filterStatus !== "All" && filterStatus === "open"       && c.status !== "open")   return false
    if (filterStatus !== "All" && filterStatus === "tba"        && c.status !== "tba")    return false
    if (filterStatus !== "All" && filterStatus === "closed"     && c.status !== "closed") return false
    if (filterStatus === "bookmarked" && !bookmarks.includes(c.id)) return false
    if (filterCat  !== "All" && c.category !== filterCat)  return false
    if (filterMode !== "All" && !c.mode.includes(filterMode)) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.org.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  if (sortBy === "deadline") {
    filtered.sort((a, b) => {
      const da = daysUntil(a.deadline), db = daysUntil(b.deadline)
      if (da === null && db === null) return 0
      if (da === null) return 1; if (db === null) return -1
      return da - db
    })
  } else if (sortBy === "name")     { filtered.sort((a, b) => a.name.localeCompare(b.name)) }
    else if (sortBy === "category") { filtered.sort((a, b) => a.category.localeCompare(b.category)) }

  // ── Live AI Search via Anthropic API ──
  const fetchLiveCompetitions = async () => {
    if (!liveQuery.trim()) return
    setLiveLoading(true)
    setLiveError("")
    setShowLive(true)
    try {
      const prompt = `You are a quant finance expert. Search your knowledge for quant trading competitions, datathons, or research programs related to: "${liveQuery}".

Return ONLY a JSON array (no markdown, no preamble) of up to 8 results. Each object must have exactly these fields:
{
  "name": "Competition Name",
  "org": "Organizing Firm",
  "deadline": "YYYY-MM-DD or TBA",
  "start": "YYYY-MM-DD",
  "mode": "Online|In-Person|Hybrid",
  "location": "City, Country or Global",
  "status": "open|tba|closed",
  "category": "one of: ML & Data Science|Algo Trading|Options & Market Making|Portfolio Management|Discovery Program|Conference|Competitive Programming|Research",
  "prize": "prize description or —",
  "link": "https://...",
  "desc": "2-sentence description"
}

Focus on real, verifiable competitions. If deadline is unknown use TBA. Today is ${new Date().toISOString().slice(0,10)}.`

      if (!aiSettings?.key) throw new Error("NO_KEY")
      const raw = await callAI({ prompt, maxTokens: 2000, aiSettings })
      const clean = raw.replace(/```json|```/g,"").trim()
      const parsed = JSON.parse(clean)
      const enriched = parsed.map((c,i) => ({ ...c, id:`live_${Date.now()}_${i}`, isLive:true }))
      setLiveResults(enriched)
    } catch(e) {
      setLiveError("Search failed. Try a different query.")
      setLiveResults([])
    }
    setLiveLoading(false)
  }

  const StatusBadge = ({ status }) => {
    const cfg = { open:{label:"✅ OPEN",color:"#10b981"}, tba:{label:"🔜 TBA",color:"#C17F3A"}, closed:{label:"⛔ CLOSED",color:"#ef4444"} }
    const { label, color } = cfg[status] || cfg.tba
    return <span style={{ fontSize:10, color, fontFamily:"'JetBrains Mono', monospace", border:`1px solid ${color}30`, padding:"2px 8px", borderRadius:4 }}>{label}</span>
  }

  const CompCard = ({ c }) => {
    const days = daysUntil(c.deadline)
    const catColor = CATEGORY_COLORS[c.category] || "#64748b"
    const isBookmarked = bookmarks.includes(c.id)
    return (
      <div style={{ background:bg, border:`1px solid ${c.status==="open"?"rgba(16,185,129,0.2)":c.isLive?"rgba(193,127,58,0.2)":bdr}`, borderRadius:12, padding:"16px 18px", display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:4, flexWrap:"wrap" }}>
              <span style={{ fontSize:10, color:catColor, background:`${catColor}15`, padding:"2px 8px", borderRadius:4, fontFamily:"'JetBrains Mono', monospace", textTransform:"uppercase", letterSpacing:"0.05em" }}>{c.category}</span>
              <StatusBadge status={c.status} />
              {c.isLive && <span style={{ fontSize:9, color:"#C17F3A", background:"rgba(193,127,58,0.1)", padding:"2px 6px", borderRadius:3 }}>✦ AI</span>}
            </div>
            <div style={{ fontSize:14, fontWeight:700, color:txt, lineHeight:1.3 }}>{c.name}</div>
            <div style={{ fontSize:11, color:sub, marginTop:2 }}>{c.org} · {c.location}</div>
          </div>
          <button onClick={() => toggleBookmark(c.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:16, marginLeft:8, color:isBookmarked?"#C17F3A":muted }}>
            {isBookmarked ? "★" : "☆"}
          </button>
        </div>
        <p style={{ fontSize:12, color:sub, margin:0, lineHeight:1.5 }}>{c.desc}</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          <div>
            <div style={{ fontSize:10, color:muted, marginBottom:2 }}>DEADLINE</div>
            <div style={{ fontSize:12, fontFamily:"'JetBrains Mono', monospace", color:days!==null&&days<=7?"#ef4444":days!==null&&days<=14?"#C17F3A":txt }}>
              {days !== null ? `${days}d → ${formatDate(c.deadline)}` : c.deadline==="N/A"?"N/A":"TBA"}
            </div>
          </div>
          <div>
            <div style={{ fontSize:10, color:muted, marginBottom:2 }}>MODE</div>
            <div style={{ fontSize:12, color:sub, fontFamily:"'JetBrains Mono', monospace" }}>{c.mode.split(" ")[0]}</div>
          </div>
          {c.prize && c.prize !== "—" && (
            <div>
              <div style={{ fontSize:10, color:muted, marginBottom:2 }}>PRIZE</div>
              <div style={{ fontSize:12, color:"#C17F3A", fontFamily:"'JetBrains Mono', monospace" }}>{c.prize}</div>
            </div>
          )}
          <div style={{ display:"flex", alignItems:"flex-end", gap:6 }}>
            <a href={c.link} target="_blank" rel="noreferrer" style={{ fontSize:12, color:"#C17F3A", textDecoration:"none", border:"1px solid rgba(193,127,58,0.3)", padding:"4px 12px", borderRadius:6 }}>Register →</a>
            <button onClick={()=>setOpenNotes(p=>({...p,[c.id]:!p[c.id]}))}
              style={{ fontSize:11,padding:"4px 8px",borderRadius:6,cursor:"pointer",
                border:`1px solid ${compNotes[c.id]?"rgba(99,102,241,0.4)":"rgba(255,255,255,0.1)"}`,
                background:compNotes[c.id]?"rgba(99,102,241,0.12)":"transparent",
                color:compNotes[c.id]?"#818cf8":"#475569" }}>
              {openNotes[c.id]?"✕":"📝"}
            </button>
          </div>
        </div>
        {openNotes[c.id] && (
          <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${bdr}` }}>
            <textarea
              value={compNotes[c.id]||""}
              onChange={e=>setCompNotes(p=>({...p,[c.id]:e.target.value}))}
              placeholder="Personal notes, team info, requirements..."
              style={{ width:"100%", minHeight:60, background:inBg,
                border:"1px solid rgba(99,102,241,0.25)", borderRadius:8,
                padding:"8px 12px", color:txt, fontSize:12, resize:"vertical",
                outline:"none", fontFamily:"inherit", lineHeight:1.5, boxSizing:"border-box" }}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom:20, display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:700, color:txt, fontFamily:"'Syne', sans-serif", margin:0 }}>Competitions</h1>
          <p style={{ color:sub, margin:"4px 0 0", fontSize:13 }}>{LIVE_COMPS.length} competitions · Track your applications</p>
        </div>
        <button onClick={exportICS}
          title="Download all open competition deadlines as a .ics calendar file"
          style={{ padding:"7px 16px", borderRadius:10, border:"1px solid rgba(16,185,129,0.3)",
            background:"rgba(16,185,129,0.08)", color:"#10b981", fontSize:11,
            cursor:"pointer", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.06em",
            whiteSpace:"nowrap", flexShrink:0 }}>
          📅 Export to Calendar (.ics)
        </button>
      </div>

      {/* ══ COMPETITIONS ══ */}
      <>
      {/* ── AI Live Search bar ── */}
      <div style={{ background:"rgba(193,127,58,0.06)", border:"1px solid rgba(193,127,58,0.2)", borderRadius:12, padding:"14px 18px", marginBottom:20 }}>
        <div style={{ fontSize:11, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", marginBottom:8, letterSpacing:"0.08em" }}>✦ AI LIVE SEARCH — discover competitions beyond the curated list</div>
        <div style={{ display:"flex", gap:8 }}>
          <input value={liveQuery} onChange={e=>setLiveQuery(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&fetchLiveCompetitions()}
            placeholder='e.g. "crypto quant competitions 2026" or "ML datathon London"...'
            style={{ flex:1, background:inBg, border:`1px solid rgba(193,127,58,0.25)`, borderRadius:8, padding:"8px 14px", color:txt, fontSize:13, outline:"none" }} />
          <button onClick={fetchLiveCompetitions} disabled={liveLoading}
            style={{ background:"rgba(193,127,58,0.2)", border:"1px solid rgba(193,127,58,0.4)", borderRadius:8, padding:"8px 20px", color:"#C17F3A", fontSize:13, cursor:"pointer", fontWeight:600, whiteSpace:"nowrap" }}>
            {liveLoading ? "Searching..." : "🔍 Search"}
          </button>
          {showLive && <button onClick={() => { setShowLive(false); setLiveResults([]) }}
            style={{ background:"transparent", border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 14px", color:muted, fontSize:12, cursor:"pointer" }}>
            ✕ Hide
          </button>}
        </div>
        {liveError && <div style={{ fontSize:12, color:"#ef4444", marginTop:8 }}>{liveError}</div>}
      </div>

      {/* ── Live Results ── */}
      {showLive && liveResults.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:12, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", marginBottom:12 }}>✦ AI RESULTS ({liveResults.length}) — verify deadlines on official sites</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))", gap:12 }}>
            {liveResults.map((c,i) => <CompCard key={i} c={c} />)}
          </div>
          <div style={{ height:1, background:`linear-gradient(90deg,rgba(193,127,58,0.3),transparent)`, margin:"24px 0" }} />
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search competitions & firms..."
          style={{ background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"7px 14px", color:txt, fontSize:13, outline:"none", minWidth:240 }} />
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[["All","All"],["open","Open Now"],["tba","TBA"],["closed","Closed"],["bookmarked","★ Saved"]].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)} style={{ padding:"6px 12px", borderRadius:6, border:"1px solid", fontSize:12, cursor:"pointer",
              borderColor:filterStatus===val?"#10b981":bdr,
              background:filterStatus===val?"rgba(16,185,129,0.15)":"transparent",
              color:filterStatus===val?"#10b981":sub }}>{label}</button>
          ))}
        </div>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"6px 10px", color:sub, fontSize:12, cursor:"pointer" }}>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterMode} onChange={e=>setFilterMode(e.target.value)} style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"6px 10px", color:sub, fontSize:12, cursor:"pointer" }}>
          {modes.map(m => <option key={m}>{m}</option>)}
        </select>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"6px 10px", color:sub, fontSize:12, cursor:"pointer" }}>
          <option value="deadline">Sort: Deadline</option>
          <option value="name">Sort: Name</option>
          <option value="category">Sort: Category</option>
        </select>
        <span style={{ fontSize:12, color:muted, marginLeft:"auto" }}>{filtered.length} shown</span>
      </div>

      {/* ── Curated Grid ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))", gap:12 }}>
        {filtered.map(c => <CompCard key={c.id} c={c} />)}
      </div>
      </>
    </div>
  )
}

// ─────────────────────────────────────────────
//  InternshipsTab + JobsTab — used inside CareerPrep
// ─────────────────────────────────────────────
const InternshipsTab = ({ T, githubData = {} }) => {
  const LIVE_INTERNSHIPS = githubData.internships || INTERNSHIPS
  const bg    = T?.cardBg    || "rgba(255,255,255,0.04)"
  const bdr   = T?.cardBorder|| "rgba(180,90,40,0.18)"
  const txt   = T?.text      || "#E8D5C0"
  const sub   = T?.textSub   || "#8B6250"
  const muted = T?.textMuted || "#5a3828"
  const inBg  = T?.inputBg   || "rgba(255,255,255,0.05)"
  const selBg = T?.inputBg   || "rgba(255,255,255,0.05)"

  const [trackedApps, setTrackedApps] = useStorage("comp_applications_v1", {})
  const [internSearch, setInternSearch] = useState("")
  const [internType,   setInternType]   = useState("All")
  const [internStatus, setInternStatus] = useState("All")

  const APP_STATES = ["None", "Applied", "Interviewing", "Offer", "Rejected"]
  const APP_COLORS = { None:"#475569", Applied:"#6366f1", Interviewing:"#C17F3A", Offer:"#10b981", Rejected:"#ef4444" }

  const internTypes = ["All", ...Array.from(new Set(LIVE_INTERNSHIPS.map(i => i.type))).sort()]
  const filtered = LIVE_INTERNSHIPS.filter(i => {
    if (internType   !== "All" && i.type   !== internType)   return false
    if (internStatus !== "All" && i.status !== internStatus) return false
    if (internSearch && !i.company.toLowerCase().includes(internSearch.toLowerCase()) &&
        !i.role.toLowerCase().includes(internSearch.toLowerCase())) return false
    return true
  })
  const stats = {
    Applied:      Object.values(trackedApps).filter(s=>s==="Applied").length,
    Interviewing: Object.values(trackedApps).filter(s=>s==="Interviewing").length,
    Offer:        Object.values(trackedApps).filter(s=>s==="Offer").length,
  }

  return (
    <div>
      {/* Stats row */}
      <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        {Object.entries(stats).map(([k,v])=>(
          <div key={k} style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:10, padding:"10px 18px", textAlign:"center" }}>
            <div style={{ fontSize:22, fontWeight:800, color:APP_COLORS[k], fontFamily:"'Syne',sans-serif" }}>{v}</div>
            <div style={{ fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>{k}</div>
          </div>
        ))}
        <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:10, padding:"10px 18px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:txt, fontFamily:"'Syne',sans-serif" }}>{filtered.length}</div>
          <div style={{ fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>Shown</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        <input value={internSearch} onChange={e=>setInternSearch(e.target.value)} placeholder="Search company / role…"
          style={{ background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"7px 14px", color:txt, fontSize:13, outline:"none", minWidth:200 }}/>
        <select value={internType} onChange={e=>setInternType(e.target.value)}
          style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"7px 10px", color:sub, fontSize:12, cursor:"pointer" }}>
          {internTypes.map(t=><option key={t}>{t}</option>)}
        </select>
        <select value={internStatus} onChange={e=>setInternStatus(e.target.value)}
          style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"7px 10px", color:sub, fontSize:12, cursor:"pointer" }}>
          {["All","open","tba","closed"].map(s=><option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:12 }}>
        {filtered.map(i => {
          const app = trackedApps[i.id]||"None"
          const ac  = APP_COLORS[app]||"#475569"
          const sc  = i.status==="open"?"#10b981":i.status==="tba"?"#C17F3A":"#475569"
          return (
            <div key={i.id} style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, marginBottom:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:700, color:txt, marginBottom:2 }}>{i.company}</div>
                  <div style={{ fontSize:12, color:sub }}>{i.role}</div>
                  <div style={{ fontSize:11, color:muted, marginTop:2 }}>📍 {i.location}</div>
                </div>
                <span style={{ fontSize:9, color:sc, fontFamily:"'JetBrains Mono',monospace", background:`${sc}14`, border:`1px solid ${sc}30`, padding:"2px 7px", borderRadius:4, flexShrink:0 }}>● {i.status}</span>
              </div>
              {i.notes && <div style={{ fontSize:11, color:muted, marginBottom:10, lineHeight:1.5, fontStyle:"italic" }}>{i.notes}</div>}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <a href={i.link} target="_blank" rel="noreferrer"
                  style={{ fontSize:12, color:"#C17F3A", border:"1px solid rgba(193,127,58,0.3)", padding:"5px 14px", borderRadius:6, textDecoration:"none", background:"rgba(193,127,58,0.08)", fontWeight:600 }}>Apply →</a>
                <select value={app} onChange={e=>setTrackedApps(p=>({...p,[i.id]:e.target.value}))}
                  style={{ background:selBg, border:`1px solid ${ac}40`, borderRadius:6, padding:"5px 10px", color:ac, fontSize:11, cursor:"pointer", flex:1 }}>
                  {APP_STATES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const JobsTab = ({ T, githubData = {} }) => {
  const LIVE_JOBS = githubData.jobs || JOBS
  const bg    = T?.cardBg    || "rgba(255,255,255,0.04)"
  const bdr   = T?.cardBorder|| "rgba(180,90,40,0.18)"
  const txt   = T?.text      || "#E8D5C0"
  const sub   = T?.textSub   || "#8B6250"
  const muted = T?.textMuted || "#5a3828"
  const inBg  = T?.inputBg   || "rgba(255,255,255,0.05)"
  const selBg = T?.inputBg   || "rgba(255,255,255,0.05)"

  const [jobApps, setJobApps]     = useStorage("job_applications_v1", {})
  const [jobSearch, setJobSearch] = useState("")
  const [jobType,   setJobType]   = useState("All")
  const [jobStatus, setJobStatus] = useState("All")

  const JOB_TYPES  = ["All","QR","QT","QD","SWE","Risk","Other"]
  const JOB_STATES = ["—","saved","applied","interviewing","offer","rejected"]
  const JOB_STATE_COLORS = { saved:"#6366f1", applied:"#0ea5e9", interviewing:"#C17F3A", offer:"#10b981", rejected:"#475569" }

  const filtered = LIVE_JOBS.filter(j=>{
    if (jobType   !== "All" && j.type   !== jobType)   return false
    if (jobStatus !== "All" && j.status !== jobStatus) return false
    if (jobSearch && !j.company.toLowerCase().includes(jobSearch.toLowerCase()) &&
        !j.role.toLowerCase().includes(jobSearch.toLowerCase())) return false
    return true
  })

  return (
    <div>
      {/* Filters */}
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
        <input value={jobSearch} onChange={e=>setJobSearch(e.target.value)} placeholder="Search company or role…"
          style={{ background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"7px 14px", color:txt, fontSize:13, outline:"none", minWidth:200 }}/>
        <select value={jobType} onChange={e=>setJobType(e.target.value)}
          style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"7px 10px", color:sub, fontSize:12, cursor:"pointer" }}>
          {JOB_TYPES.map(t=><option key={t}>{t}</option>)}
        </select>
        <select value={jobStatus} onChange={e=>setJobStatus(e.target.value)}
          style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"7px 10px", color:sub, fontSize:12, cursor:"pointer" }}>
          {["All","open","rolling","closed"].map(s=><option key={s}>{s}</option>)}
        </select>
        <span style={{ fontSize:12, color:muted, marginLeft:"auto" }}>{filtered.length} roles</span>
      </div>
      {/* Legend */}
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        {[["QR","Quant Researcher","#C17F3A"],["QT","Quant Trader","#10b981"],["QD","Quant Developer","#6366f1"],["SWE","Software Eng","#0ea5e9"]].map(([t,l,c])=>(
          <span key={t} style={{ fontSize:10, color:c, background:`${c}12`, border:`1px solid ${c}30`, padding:"2px 8px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace" }}>{t} · {l}</span>
        ))}
      </div>
      {/* Cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(360px,1fr))", gap:12 }}>
        {filtered.map(j=>{
          const typeColors = { QR:"#C17F3A", QT:"#10b981", QD:"#6366f1", SWE:"#0ea5e9", Risk:"#ec4899", Other:"#94a3b8" }
          const tc  = typeColors[j.type]||"#94a3b8"
          const app = jobApps[j.id]||"—"
          const ac  = JOB_STATE_COLORS[app]||"#475569"
          const sc  = j.status==="open"?"#10b981":j.status==="rolling"?"#C17F3A":"#475569"
          return (
            <div key={j.id} style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 20px", borderLeft:`3px solid ${tc}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, marginBottom:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4, flexWrap:"wrap" }}>
                    <span style={{ fontSize:10, color:tc, background:`${tc}14`, border:`1px solid ${tc}30`, padding:"2px 7px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>{j.type}</span>
                    <span style={{ fontSize:10, color:sc, fontFamily:"'JetBrains Mono',monospace" }}>● {j.status}</span>
                  </div>
                  <div style={{ fontSize:15, fontWeight:700, color:txt, lineHeight:1.3, marginBottom:3 }}>{j.role}</div>
                  <div style={{ fontSize:13, color:sub }}>{j.company}</div>
                  <div style={{ fontSize:11, color:muted, marginTop:2 }}>📍 {j.location}</div>
                </div>
              </div>
              {j.notes && <div style={{ fontSize:11, color:muted, marginBottom:12, lineHeight:1.5, fontStyle:"italic" }}>{j.notes}</div>}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <a href={j.link} target="_blank" rel="noreferrer"
                  style={{ fontSize:12, color:tc, textDecoration:"none", border:`1px solid ${tc}35`, padding:"5px 14px", borderRadius:6, background:`${tc}10`, fontWeight:600 }}>Apply →</a>
                <select value={app} onChange={e=>setJobApps(p=>({...p,[j.id]:e.target.value}))}
                  style={{ background:selBg, border:`1px solid ${ac}40`, borderRadius:6, padding:"5px 10px", color:ac, fontSize:11, cursor:"pointer", flex:1 }}>
                  {JOB_STATES.map(s=><option key={s} value={s}>{s==="—"?"Track status…":s}</option>)}
                </select>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
//  MODULE: INTERVIEW PREP (Claude AI)
// ─────────────────────────────────────────────


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/components/modules/InterviewPrep.jsx  (when splitting)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/components/modules/PracticeHub.jsx
// Unified practice module: Interview Prep + Flashcards in one place
// Two top-level tabs keep all features intact while halving sidebar clutter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PracticeHub = ({ T, isMobile, aiSettings, markStudyToday = ()=>{} }) => {
  const bg   = T?.cardBg    || "rgba(255,255,255,0.04)"
  const bdr  = T?.cardBorder|| "rgba(255,255,255,0.08)"
  const txt  = T?.text      || "#f1f5f9"
  const sub  = T?.textSub   || "#64748b"
  const muted= T?.textMuted || "#475569"
  const inBg = T?.inputBg   || "rgba(255,255,255,0.055)"
  const selBg= T?.selectBg  || "#0c0c1e"

  // ── Top-level tab ──────────────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState("interview")  // "interview" | "flashcards"

  // ══ INTERVIEW STATE ════════════════════════════════════════════════════════
  const [category,        setCategory]       = useState("Probability & Stats")
  const [difficulty,      setDifficulty]     = useState("Medium")
  const [question,        setQuestion]       = useState("")
  const [userAnswer,      setUserAnswer]     = useState("")
  const [feedback,        setFeedback]       = useState(null)
  const [loading,         setLoading]        = useState(false)
  const [loadingQ,        setLoadingQ]       = useState(false)
  const [score,           setScore]          = useState(null)
  const [history,         setHistory]        = useStorage("interview_history", [])
  const [customCards,     setCustomCards]    = useStorage("custom_flashcards_v1", [])
  const [savedToFlashcard,setSavedToFlashcard] = useState(false)
  const [mode,            setMode]           = useState("ai")  // "ai" | "bank"
  const [bankIdx,         setBankIdx]        = useState(0)

  // ══ FLASHCARD STATE ════════════════════════════════════════════════════════
  const CUSTOM_DECK = { id:"custom", name:"📌 From Interview", color:"#818cf8",
    cards: customCards.map(c => ({ q:c.q, a:c.a })) }
  const ALL_DECKS   = customCards.length > 0 ? [...FLASHCARD_DECKS, CUSTOM_DECK] : FLASHCARD_DECKS

  const [activeDeck, setActiveDeck] = useState(FLASHCARD_DECKS[0].id)
  const [cardIdx,    setCardIdx]    = useState(0)
  const [flipped,    setFlipped]    = useState(false)
  const [scores,     setScores]     = useStorage("flashcard_scores_v1", {})

  const deck    = ALL_DECKS.find(d => d.id === activeDeck) || ALL_DECKS[0]
  const card    = deck.cards[cardIdx % Math.max(deck.cards.length, 1)]
  const total   = deck.cards.length
  const cardKey = `${deck.id}_${cardIdx}`

  const rate = (rating) => {
    markStudyToday(); setScores(prev => ({ ...prev, [cardKey]: rating }))
    setCardIdx(i => (i + 1) % Math.max(total, 1))
    setFlipped(false)
  }

  const deckStats = (d) => {
    const easy = d.cards.filter((_, i) => scores[`${d.id}_${i}`] === "easy").length
    return { easy, pct: Math.round(d.cards.length ? (easy / d.cards.length) * 100 : 0) }
  }

  // ══ INTERVIEW HELPERS ══════════════════════════════════════════════════════
  const DIFF_PROMPTS = { Easy:"beginner-friendly", Medium:"intermediate", Hard:"challenging hedge fund interview level" }

  const generateQuestion = async () => {
    setLoadingQ(true); setQuestion(""); setFeedback(null); setUserAnswer(""); setScore(null)
    try {
      if (!aiSettings?.key) { setQuestion("Set your AI provider key in ⚙ Settings to generate questions."); setLoadingQ(false); return }
      const result = await callAI({
        system: `You are an expert quant finance interviewer at a top HFT firm. Generate a single ${DIFF_PROMPTS[difficulty]} interview question for the category: ${category}. Output ONLY the question text, no preamble, no answer.`,
        prompt: `Generate a ${difficulty} ${category} question. Just the question, no explanation.`,
        maxTokens: 500, aiSettings
      })
      setQuestion(result || "Failed to generate.")
    } catch { setQuestion("Could not connect to AI. Try the Question Bank instead.") }
    setLoadingQ(false)
  }

  const evalAnswer = async () => {
    if (!userAnswer.trim()) return
    setLoading(true); setFeedback(null)
    try {
      if (!aiSettings?.key) { setFeedback("Set your AI provider key in ⚙ Settings to get feedback."); setLoading(false); return }
      const text = await callAI({
        system: "You are an expert quant interviewer. Evaluate the student's answer. Be constructive. Format: SCORE: X/10\n\nFEEDBACK: ...\n\nIDEAL ANSWER: ...",
        prompt: `Question: ${question}\n\nStudent Answer: ${userAnswer}\n\nEvaluate this answer. Difficulty: ${difficulty}.`,
        maxTokens: 800, aiSettings
      })
      setFeedback(text)
      const match = text.match(/SCORE:\s*(\d+)\/10/)
      const s = match ? parseInt(match[1]) : null
      setScore(s)
      if (s !== null) { markStudyToday(); setHistory(prev => [{ question, answer:userAnswer, score:s, category, difficulty, date:new Date().toLocaleDateString() }, ...prev].slice(0,20)) }
    } catch { setFeedback("Could not evaluate. Check connection.") }
    setLoading(false)
  }

  const saveToFlashcard = () => {
    const q = mode === "bank" ? bankQ[bankIdx % bankQ.length] : question
    if (!q || !feedback) return
    const idealMatch = feedback.match(/IDEAL ANSWER:\s*([\s\S]+)/)
    const a = idealMatch ? idealMatch[1].trim().slice(0,400) : feedback.slice(0,400)
    setCustomCards(prev => [{ q, a, category, addedAt:new Date().toLocaleDateString() }, ...prev].slice(0,50))
    setSavedToFlashcard(true)
    setTimeout(() => setSavedToFlashcard(false), 2000)
  }

  const bankQ = INTERVIEW_QS[category] || []
  const currentBankQ = bankQ[bankIdx % Math.max(bankQ.length, 1)]
  const avgScore = history.length > 0 ? Math.round(history.reduce((a,b) => a+b.score, 0) / history.length * 10) / 10 : null
  const totalCards = ALL_DECKS.reduce((a,d) => a+d.cards.length, 0)

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom:20 }}>
        <h1 style={{ fontSize:26, fontWeight:700, color:txt, fontFamily:"'Syne',sans-serif", margin:0 }}>Practice</h1>
        <p style={{ color:sub, margin:"4px 0 0", fontSize:13 }}>
          {history.length} interview sessions{avgScore ? ` · avg ${avgScore}/10` : ""} · {totalCards} flashcards across {ALL_DECKS.length} decks
        </p>
      </div>

      {/* ── Main tab switcher ── */}
      <div style={{ display:"flex", gap:8, marginBottom:22, borderBottom:`1px solid ${bdr}`, paddingBottom:14 }}>
        {[["interview","◉ Interview Prep"],["flashcards","▣ Flashcards"]].map(([id,label]) => (
          <button key={id} onClick={() => setMainTab(id)} style={{
            padding:"9px 22px", borderRadius:10, border:"1px solid", fontSize:13, cursor:"pointer", fontWeight:600,
            borderColor: mainTab===id ? "#6366f1" : bdr,
            background:  mainTab===id ? "rgba(99,102,241,0.15)" : "transparent",
            color:       mainTab===id ? "#818cf8" : sub,
            boxShadow:   mainTab===id ? "0 0 0 1px rgba(99,102,241,0.2) inset" : "none",
          }}>{label}</button>
        ))}
        {customCards.length > 0 && mainTab === "flashcards" && (
          <span style={{ marginLeft:"auto", fontSize:11, color:"#818cf8", alignSelf:"center", fontFamily:"'JetBrains Mono',monospace" }}>
            {customCards.length} saved from Interview
          </span>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          INTERVIEW PREP TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {mainTab === "interview" && (
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 280px", gap:18 }}>
          <div>
            {/* Controls */}
            <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
              <select value={category} onChange={e => setCategory(e.target.value)}
                style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 12px", color:txt, fontSize:13, cursor:"pointer" }}>
                {Object.keys(INTERVIEW_QS).map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)}
                style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 12px", color:txt, fontSize:13, cursor:"pointer" }}>
                {["Easy","Medium","Hard"].map(d => <option key={d}>{d}</option>)}
              </select>
              <div style={{ display:"flex", gap:6 }}>
                {[["ai","🤖 AI Generate"],["bank","📚 Question Bank"]].map(([m,label]) => (
                  <button key={m} onClick={() => setMode(m)} style={{ padding:"7px 14px", borderRadius:8, border:"1px solid", fontSize:12, cursor:"pointer",
                    borderColor: mode===m ? "#6366f1" : bdr,
                    background:  mode===m ? "rgba(99,102,241,0.2)" : "transparent",
                    color:       mode===m ? "#818cf8" : sub }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Question Card */}
            <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"20px 24px", marginBottom:14 }}>
              {mode === "ai" ? (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <span style={{ fontSize:11, color:"#6366f1", fontFamily:"'JetBrains Mono',monospace", textTransform:"uppercase" }}>AI Question · {category}</span>
                    <button onClick={generateQuestion} disabled={loadingQ}
                      style={{ background:"rgba(99,102,241,0.2)", border:"1px solid rgba(99,102,241,0.4)", borderRadius:8, padding:"7px 16px", color:"#818cf8", fontSize:12, cursor:"pointer" }}>
                      {loadingQ ? "Generating..." : "Generate Question →"}
                    </button>
                  </div>
                  <div style={{ fontSize:15, color:question ? txt : muted, lineHeight:1.6, minHeight:60 }}>
                    {question || "Click 'Generate Question' to get an AI-crafted interview question."}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <span style={{ fontSize:11, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", textTransform:"uppercase" }}>Question Bank · {bankIdx+1}/{bankQ.length}</span>
                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={() => { setBankIdx(b => Math.max(0,b-1)); setFeedback(null); setUserAnswer(""); setScore(null) }}
                        style={{ background:"rgba(193,127,58,0.1)", border:"1px solid rgba(193,127,58,0.3)", borderRadius:6, padding:"6px 12px", color:"#C17F3A", fontSize:12, cursor:"pointer" }}>←</button>
                      <button onClick={() => { setBankIdx(b => (b+1)%bankQ.length); setFeedback(null); setUserAnswer(""); setScore(null) }}
                        style={{ background:"rgba(193,127,58,0.1)", border:"1px solid rgba(193,127,58,0.3)", borderRadius:6, padding:"6px 12px", color:"#C17F3A", fontSize:12, cursor:"pointer" }}>→</button>
                    </div>
                  </div>
                  <div style={{ fontSize:15, color:txt, lineHeight:1.6 }}>{currentBankQ}</div>
                </>
              )}
            </div>

            {/* Answer Box */}
            {(question || mode === "bank") && (
              <div style={{ marginBottom:14 }}>
                <textarea value={userAnswer} onChange={e => setUserAnswer(e.target.value)}
                  placeholder="Type your answer here..."
                  style={{ width:"100%", minHeight:120, background:inBg, border:`1px solid ${bdr}`, borderRadius:10, padding:"14px 16px", color:txt, fontSize:13, resize:"vertical", outline:"none", fontFamily:"inherit", boxSizing:"border-box", lineHeight:1.6 }}
                />
                <button onClick={async () => {
                  if (mode === "bank") {
                    setLoading(true); setFeedback(null)
                    try {
                      if (!aiSettings?.key) { setFeedback("Set your AI key in ⚙ Settings to get feedback."); setLoading(false); return }
                      const text = await callAI({
                        system: "You are an expert quant interviewer. Evaluate the answer. Format: SCORE: X/10\n\nFEEDBACK: ...\n\nIDEAL ANSWER: ...",
                        prompt: `Question: ${currentBankQ}\n\nAnswer: ${userAnswer}\n\nCategory: ${category}, Difficulty: ${difficulty}`,
                        maxTokens: 800, aiSettings
                      })
                      setFeedback(text)
                      const m = text.match(/SCORE:\s*(\d+)\/10/)
                      if (m) { const s=parseInt(m[1]); setScore(s); markStudyToday(); setHistory(prev=>[{ question:currentBankQ, answer:userAnswer, score:s, category, difficulty, date:new Date().toLocaleDateString() },...prev].slice(0,20)) }
                    } catch { setFeedback("Eval failed.") }
                    setLoading(false)
                  } else { evalAnswer() }
                }} disabled={loading||!userAnswer.trim()}
                  style={{ marginTop:10, background:"rgba(16,185,129,0.2)", border:"1px solid rgba(16,185,129,0.4)", borderRadius:8, padding:"9px 20px", color:"#10b981", fontSize:13, cursor:"pointer", fontWeight:600 }}>
                  {loading ? "Evaluating..." : "Submit Answer for AI Review →"}
                </button>
              </div>
            )}

            {/* Feedback */}
            {feedback && (
              <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"20px 24px" }}>
                {score !== null && (
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
                    <div style={{ fontSize:42, fontWeight:800, fontFamily:"'Syne',sans-serif", color: score>=8?"#10b981":score>=5?"#C17F3A":"#ef4444" }}>{score}</div>
                    <div>
                      <div style={{ fontSize:16, color:sub }}>/ 10</div>
                      <div style={{ fontSize:11, color:muted }}>{score>=8?"Excellent!":score>=5?"Good progress":"Keep practicing"}</div>
                    </div>
                    <button onClick={() => { saveToFlashcard(); if(!savedToFlashcard) setMainTab("flashcards") }}
                      style={{ marginLeft:"auto", padding:"7px 14px", borderRadius:8, whiteSpace:"nowrap", transition:"all 0.2s",
                        border:`1px solid ${savedToFlashcard?"rgba(16,185,129,0.4)":"rgba(99,102,241,0.3)"}`,
                        background:savedToFlashcard?"rgba(16,185,129,0.12)":"rgba(99,102,241,0.10)",
                        color:savedToFlashcard?"#10b981":"#818cf8",
                        fontSize:11, cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>
                      {savedToFlashcard ? "✓ Saved! → Flashcards" : "▣ Save to Flashcards"}
                    </button>
                  </div>
                )}
                <div style={{ fontSize:13, color:txt, lineHeight:1.8, whiteSpace:"pre-wrap" }}>{feedback}</div>
              </div>
            )}
          </div>

          {/* ── History Sidebar ── */}
          <div>
            <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"16px 18px" }}>

              {/* Spaced Repetition — weak categories */}
              {history.length >= 3 && (() => {
                const catScores = Object.keys(INTERVIEW_QS).map(cat => {
                  const sessions = history.filter(h => h.category===cat)
                  if (!sessions.length) return null
                  const avg = sessions.reduce((a,b) => a+b.score,0)/sessions.length
                  return { cat, avg, count:sessions.length }
                }).filter(Boolean).sort((a,b) => a.avg-b.avg)
                const weak = catScores.filter(c => c.avg < 6)
                if (!weak.length) return null
                return (
                  <div style={{ marginBottom:14, padding:"10px 12px", background:"rgba(239,68,68,0.06)", borderRadius:8, border:"1px solid rgba(239,68,68,0.18)" }}>
                    <div style={{ fontSize:9, color:"#ef4444", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.1em", marginBottom:6 }}>🔁 REVIEW NEEDED</div>
                    <div style={{ fontSize:11, color:sub, marginBottom:8, lineHeight:1.5 }}>Your weakest areas:</div>
                    {weak.slice(0,3).map(w => (
                      <div key={w.cat} onClick={() => { setCategory(w.cat); setMode("bank") }}
                        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"5px 8px", borderRadius:6, cursor:"pointer", marginBottom:4, background:"rgba(239,68,68,0.04)", border:"1px solid rgba(239,68,68,0.1)" }}>
                        <span style={{ fontSize:11, color:txt }}>{w.cat}</span>
                        <span style={{ fontSize:10, color:"#ef4444", fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>avg {w.avg.toFixed(1)}/10</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Score trend sparkline */}
              {history.length >= 3 && (() => {
                const last10 = history.slice(0,10).reverse()
                const W=240, H=48, max=10
                return (
                  <div style={{ marginBottom:14, padding:"12px 14px", background:"rgba(99,102,241,0.06)", borderRadius:8, border:"1px solid rgba(99,102,241,0.15)" }}>
                    <div style={{ fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>SCORE TREND (last {last10.length})</div>
                    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}>
                      <polyline
                        points={last10.map((s,i) => `${(i/(last10.length-1))*(W-16)+8},${H-((s.score/max)*(H-8))-4}`).join(" ")}
                        fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />
                      {last10.map((s,i) => {
                        const x=(i/(last10.length-1))*(W-16)+8, y=H-((s.score/max)*(H-8))-4
                        return <circle key={i} cx={x} cy={y} r="3" fill={s.score>=8?"#10b981":s.score>=5?"#C17F3A":"#ef4444"} />
                      })}
                    </svg>
                    {(() => {
                      const cc=history.reduce((a,h)=>{a[h.category]=(a[h.category]||0)+1;return a},{})
                      const top=Object.entries(cc).sort((a,b)=>b[1]-a[1])[0]
                      return top && <div style={{ fontSize:10, color:muted, marginTop:4 }}>Most practiced: <span style={{ color:"#818cf8" }}>{top[0]}</span> ({top[1]}×)</div>
                    })()}
                  </div>
                )
              })()}

              <div style={{ fontSize:11, color:muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12, fontFamily:"'JetBrains Mono',monospace" }}>Recent Sessions</div>
              {history.length===0 && <p style={{ color:muted, fontSize:12 }}>No sessions yet. Start practicing!</p>}
              {history.slice(0,10).map((h,i) => (
                <div key={i} style={{ marginBottom:10, padding:"10px 12px", background:bg, borderRadius:8, borderLeft:`3px solid ${h.score>=8?"#10b981":h.score>=5?"#C17F3A":"#ef4444"}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:h.score>=8?"#10b981":h.score>=5?"#C17F3A":"#ef4444" }}>{h.score}/10</span>
                    <span style={{ fontSize:10, color:muted }}>{h.date}</span>
                  </div>
                  <div style={{ fontSize:11, color:sub }}>{h.category} · {h.difficulty}</div>
                  <div style={{ fontSize:11, color:sub, marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.question?.slice(0,55)}...</div>
                </div>
              ))}
              {history.length > 0 && (
                <button onClick={() => setHistory([])} style={{ marginTop:8, fontSize:11, color:"#ef4444", background:"none", border:"none", cursor:"pointer", padding:0 }}>Clear History</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          FLASHCARDS TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {mainTab === "flashcards" && (
        <div>
          {/* Deck selector */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:24 }}>
            {ALL_DECKS.map(d => {
              const s = deckStats(d)
              return (
                <button key={d.id} onClick={() => { setActiveDeck(d.id); setCardIdx(0); setFlipped(false) }}
                  style={{ padding:"10px 16px", borderRadius:10, border:"1px solid", cursor:"pointer", textAlign:"left", minWidth:140,
                    borderColor: activeDeck===d.id ? d.color : bdr,
                    background:  activeDeck===d.id ? `${d.color}15` : bg }}>
                  <div style={{ fontSize:13, fontWeight:600, color: activeDeck===d.id ? d.color : txt }}>{d.name}</div>
                  <div style={{ fontSize:10, color:muted, marginTop:3 }}>{d.cards.length} cards · {s.pct}% mastered</div>
                  <div style={{ height:3, borderRadius:2, background:"rgba(255,255,255,0.06)", marginTop:6, overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:2, background:d.color, width:`${s.pct}%`, transition:"width 0.5s ease" }} />
                  </div>
                </button>
              )
            })}
          </div>

          {/* Card area */}
          <div style={{ maxWidth:680, margin:"0 auto" }}>
            <div style={{ marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:11, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>
                {deck.name} · Card {(cardIdx % Math.max(total,1))+1} / {total}
              </span>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => { setCardIdx(i => (i-1+total)%total); setFlipped(false) }}
                  style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:6, padding:"4px 12px", color:sub, fontSize:12, cursor:"pointer" }}>←</button>
                <button onClick={() => { setCardIdx(i => (i+1)%total); setFlipped(false) }}
                  style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:6, padding:"4px 12px", color:sub, fontSize:12, cursor:"pointer" }}>→</button>
              </div>
            </div>

            {/* Flip card */}
            <div onClick={() => setFlipped(f => !f)}
              style={{ cursor:"pointer", background:bg, border:`2px solid ${flipped?deck.color+"60":bdr}`, borderRadius:16, padding:"40px 36px", minHeight:200, display:"flex", flexDirection:"column", justifyContent:"center", transition:"border-color 0.25s", position:"relative" }}>
              <div style={{ position:"absolute", top:14, right:18, fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>
                {flipped ? "ANSWER" : "QUESTION — click to reveal"}
              </div>
              <div style={{ fontSize:16, color:flipped?txt:sub, lineHeight:1.65, transition:"color 0.2s" }}>
                {card ? (flipped ? card.a : card.q) : "No cards in this deck."}
              </div>
            </div>

            {/* Rating buttons */}
            {flipped && (
              <div style={{ display:"flex", gap:10, marginTop:14, justifyContent:"center" }}>
                <button onClick={() => rate("skip")} style={{ flex:1, padding:"11px 0", borderRadius:8, border:`1px solid ${bdr}`, background:"transparent", color:muted, fontSize:13, cursor:"pointer" }}>⏭ Skip</button>
                <button onClick={() => rate("hard")} style={{ flex:1, padding:"11px 0", borderRadius:8, border:"1px solid rgba(239,68,68,0.4)", background:"rgba(239,68,68,0.1)", color:"#ef4444", fontSize:13, cursor:"pointer", fontWeight:600 }}>😓 Hard</button>
                <button onClick={() => rate("easy")} style={{ flex:2, padding:"11px 0", borderRadius:8, border:"1px solid rgba(16,185,129,0.4)", background:"rgba(16,185,129,0.12)", color:"#10b981", fontSize:13, cursor:"pointer", fontWeight:700 }}>✓ Got it!</button>
              </div>
            )}
            {!flipped && total > 0 && (
              <div style={{ textAlign:"center", marginTop:14 }}>
                <button onClick={() => setFlipped(true)}
                  style={{ padding:"11px 40px", borderRadius:8, border:`1px solid ${deck.color}50`, background:`${deck.color}12`, color:deck.color, fontSize:13, cursor:"pointer", fontWeight:600 }}>
                  Reveal Answer
                </button>
              </div>
            )}

            {/* Custom deck management */}
            {activeDeck === "custom" && customCards.length > 0 && (
              <div style={{ marginTop:20, padding:"14px 18px", background:bg, border:`1px solid ${"#818cf8"}25`, borderRadius:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:11, color:"#818cf8", fontFamily:"'JetBrains Mono',monospace" }}>
                    {customCards.length} cards saved from Interview Prep
                  </span>
                  <button onClick={() => { setCustomCards([]); setActiveDeck(FLASHCARD_DECKS[0].id) }}
                    style={{ fontSize:11, color:"#ef4444", background:"none", border:"none", cursor:"pointer" }}>
                    Clear all
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
//  MODULE: RESOURCE HUB
// ─────────────────────────────────────────────


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/components/modules/ResourceHub.jsx  (when splitting)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ResourceHub = ({ T }) => {
  const [papers, setPapers] = useState([])
  const [loadingPapers, setLoadingPapers] = useState(false)
  const [activeTab, setActiveTab] = useState("platforms")
  const [firmSearch, setFirmSearch] = useState("")
  const [firmType, setFirmType] = useState("All")
  const [firmCountry, setFirmCountry] = useState("All")
  const [savedPapers, setSavedPapers] = useStorage("saved_papers_v2", [])
  const [readPapers,  setReadPapers]  = useStorage("read_papers_v1",  [])
  const [paperTab, setPaperTab] = useState("browse")   // browse | saved
  const [paperQuery, setPaperQuery] = useState("q-fin")
  const [aiQuery, setAiQuery] = useState("")

  const bg   = T?.cardBg    || "rgba(255,255,255,0.02)"
  const bdr  = T?.cardBorder|| "rgba(255,255,255,0.07)"
  const txt  = T?.text      || "#f1f5f9"
  const sub  = T?.textSub   || "#64748b"
  const muted= T?.textMuted || "#475569"
  const inBg = T?.inputBg   || "rgba(255,255,255,0.04)"
  const selBg= T?.selectBg  || "#111120"

  const QF_TOPICS = [
    { label:"All q-fin",         query:"q-fin" },
    { label:"Portfolio Opt.",    query:"q-fin.PM" },
    { label:"Statistical Arb",   query:"q-fin.ST" },
    { label:"Derivatives",       query:"q-fin.PR" },
    { label:"Risk Management",   query:"q-fin.RM" },
    { label:"Market Microstr.",  query:"q-fin.TR" },
    { label:"ML in Finance",     query:"cat:q-fin+AND+machine+learning" },
    { label:"LLMs for Finance",  query:"cat:q-fin+AND+large+language+model" },
  ]

  const TYPE_COLOR = {
    "HFT / Market Making":"#C17F3A","HFT / ETF Market Making":"#C17F3A","HFT / Prop Trading":"#fb923c",
    "Prop Trading":"#f97316","Prop Trading / HFT":"#fb923c","Algorithmic Market Making":"#C17F3A",
    "Options Market Making":"#fbbf24","Options / Prop Trading":"#f97316",
    "Quant Hedge Fund":"#6366f1","Multi-Strategy HF":"#8b5cf6","Systematic HF":"#a78bfa",
    "Macro Quant HF":"#c4b5fd","Macro / Systematic HF":"#c4b5fd","Systematic HF (Point72)":"#a78bfa",
    "Systematic CTA":"#818cf8",
    "Bank Quant Desk":"#0ea5e9","Bank Quant Research":"#38bdf8",
    "Quant Asset Manager":"#10b981","Index & Risk Analytics":"#34d399",
    "Sovereign Wealth Quant":"#14b8a6","Pension Fund Quant":"#22d3ee",
    "Financial Technology":"#94a3b8","Financial Data Analytics":"#64748b",
    "Market Data Infrastructure":"#94a3b8","Exchange / Quant Research":"#38bdf8",
    "Crypto Market Making":"#ec4899","Crypto Quant / MM":"#f472b6",
    "Crypto Quant":"#fb7185","Crypto-incentivized Quant":"#f472b6",
    "AI for Finance":"#a78bfa","HFT / Quant":"#C17F3A",
  }

  const firmTypes     = ["All", ...Array.from(new Set(QUANT_FIRMS.map(f => f.t))).sort()]
  const firmCountries = ["All", ...Array.from(new Set(QUANT_FIRMS.map(f => f.co))).sort()]

  const filteredFirms = QUANT_FIRMS.filter(f => {
    if (firmType !== "All" && f.t !== firmType) return false
    if (firmCountry !== "All" && f.co !== firmCountry) return false
    if (firmSearch && !f.n.toLowerCase().includes(firmSearch.toLowerCase()) && !f.c.toLowerCase().includes(firmSearch.toLowerCase())) return false
    return true
  })

  // Auto-load latest q-fin papers when the component first mounts
  useEffect(() => { fetchPapers("q-fin") }, [])

  const fetchPapers = async (q = paperQuery) => {
    setLoadingPapers(true)
    try {
      const searchQ = q.includes("+") ? q : `cat:${q}`
      const res = await fetch(`https://export.arxiv.org/api/query?search_query=${searchQ}&sortBy=submittedDate&sortOrder=descending&max_results=12`)
      const text = await res.text()
      const parser = new DOMParser()
      const xml = parser.parseFromString(text, "text/xml")
      const entries = Array.from(xml.querySelectorAll("entry")).map(e => ({
        id:      e.querySelector("id")?.textContent?.trim(),
        title:   e.querySelector("title")?.textContent?.replace(/\s+/g," ").trim(),
        authors: Array.from(e.querySelectorAll("author name")).slice(0,3).map(a => a.textContent).join(", "),
        summary: e.querySelector("summary")?.textContent?.replace(/\s+/g," ").trim().slice(0,220) + "...",
        link:    e.querySelector("id")?.textContent?.trim(),
        date:    e.querySelector("published")?.textContent?.slice(0,10),
        cats:    Array.from(e.querySelectorAll("category")).map(c=>c.getAttribute("term")).join(", "),
      }))
      setPapers(entries)
    } catch { setPapers([]) }
    setLoadingPapers(false)
  }

  const toggleRead  = (id) => setReadPapers(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])
  const isRead      = (id) => readPapers.includes(id)
  const toggleSave  = (paper) => {
    setSavedPapers(prev => {
      const exists = prev.find(p => p.id === paper.id)
      return exists ? prev.filter(p => p.id !== paper.id) : [paper, ...prev]
    })
  }
  const isSaved = (id) => savedPapers.some(p => p.id === id)

  const handleAiSearch = async () => {
    if (!aiQuery.trim()) return
    const q = `cat:q-fin+AND+${encodeURIComponent(aiQuery.trim().replace(/\s+/g,"+"))}`
    setPaperQuery(q)
    await fetchPapers(q)
  }

  const catGroups = PLATFORMS.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})

  const PaperCard = ({ p, showRemove }) => {
    // Match paper title keywords to relevant courses
    const titleWords = (p.title||"").toLowerCase().split(/\W+/).filter(w=>w.length>4)
    const related = COURSES.filter(c=>{
      const cName = c.name.toLowerCase()
      return titleWords.some(w=>cName.includes(w))
    }).slice(0,3)

    return (
    <div style={{ marginBottom:12, background:bg, border:`1px solid ${isSaved(p.id)?"rgba(193,127,58,0.3)":bdr}`, borderRadius:12, padding:"16px 20px", transition:"border-color 0.2s" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, color:"#6366f1", fontFamily:"'JetBrains Mono', monospace" }}>arXiv · {p.date}</span>
            {p.cats && <span style={{ fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>{p.cats.split(", ")[0]}</span>}
          </div>
          <a href={p.link} target="_blank" rel="noreferrer" style={{ fontSize:14, color:txt, fontWeight:600, lineHeight:1.4, marginBottom:6, display:"block", textDecoration:"none" }}
            onMouseEnter={e=>e.currentTarget.style.color="#C17F3A"}
            onMouseLeave={e=>e.currentTarget.style.color=txt}>
            {p.title}
          </a>
          <div style={{ fontSize:12, color:sub, marginBottom:6 }}>{p.authors}</div>
          <div style={{ fontSize:12, color:sub, lineHeight:1.5 }}>{p.summary}</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
          <button onClick={() => toggleSave(p)}
            title={isSaved(p.id) ? "Remove from saved" : "Save paper"}
            style={{ background:isSaved(p.id)?"rgba(193,127,58,0.2)":bg, border:`1px solid ${isSaved(p.id)?"rgba(193,127,58,0.5)":bdr}`, borderRadius:8, padding:"6px 10px", color:isSaved(p.id)?"#C17F3A":sub, cursor:"pointer", fontSize:14 }}>
            {isSaved(p.id) ? "🔖" : "📌"}
          </button>
          <button onClick={()=>toggleRead(p.id)}
            title={isRead(p.id) ? "Mark as unread" : "Mark as read"}
            style={{ background:isRead(p.id)?"rgba(16,185,129,0.18)":bg,
              border:`1px solid ${isRead(p.id)?"rgba(16,185,129,0.45)":bdr}`,
              borderRadius:8, padding:"6px 10px", color:isRead(p.id)?"#10b981":sub,
              cursor:"pointer", fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>
            {isRead(p.id) ? "✓" : "○"}
          </button>
          <a href={p.link} target="_blank" rel="noreferrer" style={{ background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:8, padding:"6px 10px", color:"#818cf8", textDecoration:"none", fontSize:11, textAlign:"center" }}>PDF →</a>
        </div>
      </div>
      {/* Related courses */}
      {related.length>0 && (
        <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:9, color:muted, fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.08em" }}>RELATED:</span>
          {related.map(c=>(
            <span key={c.id} style={{ fontSize:10, color:SUBJECT_COLORS[c.subject]||"#6366f1",
              background:`${SUBJECT_COLORS[c.subject]||"#6366f1"}10`,
              border:`1px solid ${SUBJECT_COLORS[c.subject]||"#6366f1"}30`,
              padding:"2px 8px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace" }}>
              {c.code} · {c.name.split(" ").slice(0,3).join(" ")}
            </span>
          ))}
        </div>
      )}
    </div>
  )
  }

  return (
    <div>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:26, fontWeight:700, color:txt, fontFamily:"'Syne', sans-serif", margin:0 }}>Resource Hub</h1>
        <p style={{ color:sub, margin:"4px 0 0", fontSize:13 }}>{QUANT_FIRMS.length} quant firms worldwide · Free platforms · Live arXiv papers</p>
      </div>

      {/* Top-level tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        {[["platforms","📚 Platforms"],[`firms`,`🏢 ${QUANT_FIRMS.length} Firms`],["papers",`📄 Papers${savedPapers.length>0?` · ${readPapers.length}/${savedPapers.length} read`:""}`]].map(([id, label]) => (
          <button key={id} onClick={() => { setActiveTab(id); if (id === "papers" && !papers.length) fetchPapers() }} style={{ padding:"8px 18px", borderRadius:8, border:"1px solid", fontSize:13, cursor:"pointer",
            borderColor: activeTab === id ? "#C17F3A" : "rgba(255,255,255,0.1)",
            background:  activeTab === id ? "rgba(193,127,58,0.12)" : "transparent",
            color:       activeTab === id ? "#C17F3A" : sub }}>{label}</button>
        ))}
      </div>

      {/* ── PLATFORMS ── */}
      {activeTab === "platforms" && (
        <div>
          {Object.entries(catGroups).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, color:muted, textTransform:"uppercase", letterSpacing:"0.1em", fontFamily:"'JetBrains Mono', monospace", marginBottom:12 }}>{cat}</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:10 }}>
                {items.map(p => (
                  <a key={p.name} href={p.url} target="_blank" rel="noreferrer" style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:10, padding:"14px 16px", textDecoration:"none", display:"block", transition:"border-color 0.2s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor="rgba(193,127,58,0.4)"}
                    onMouseLeave={e => e.currentTarget.style.borderColor=bdr}>
                    <div style={{ fontSize:14, color:txt, fontWeight:600 }}>{p.name} →</div>
                    <div style={{ fontSize:12, color:sub, marginTop:4, lineHeight:1.4 }}>{p.desc}</div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── FIRMS ── */}
      {activeTab === "firms" && (
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
            <input value={firmSearch} onChange={e => setFirmSearch(e.target.value)} placeholder="Search firm or city..." style={{ background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"7px 14px", color:txt, fontSize:13, outline:"none", minWidth:220 }} />
            <select value={firmType} onChange={e => setFirmType(e.target.value)} style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"7px 10px", color:sub, fontSize:12, cursor:"pointer", maxWidth:220 }}>
              {firmTypes.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={firmCountry} onChange={e => setFirmCountry(e.target.value)} style={{ background:selBg, border:`1px solid ${bdr}`, borderRadius:6, padding:"7px 10px", color:sub, fontSize:12, cursor:"pointer" }}>
              {firmCountries.map(c => <option key={c}>{c}</option>)}
            </select>
            <span style={{ fontSize:12, color:muted, marginLeft:"auto" }}>{filteredFirms.length} firms</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))", gap:10 }}>
            {filteredFirms.map((f, i) => {
              const typeColor = TYPE_COLOR[f.t] || "#64748b"
              return (
                <a key={i} href={f.l} target="_blank" rel="noreferrer" style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:10, padding:"14px 16px", textDecoration:"none", display:"block", transition:"border-color 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor=`${typeColor}40`}
                  onMouseLeave={e => e.currentTarget.style.borderColor=bdr}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, color:txt, fontWeight:700, marginBottom:3 }}>{f.n}</div>
                      <div style={{ fontSize:11, color:sub }}>{f.co} · {f.c.split("·")[0].trim()}</div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                      <span style={{ fontSize:10, color:typeColor, background:`${typeColor}12`, border:`1px solid ${typeColor}30`, padding:"2px 7px", borderRadius:3, fontFamily:"'JetBrains Mono',monospace" }}>{f.t}</span>
                      <span style={{ fontSize:10, color:"#C17F3A" }}>Careers →</span>
                    </div>
                  </div>
                  {f.c.includes("·") && <div style={{ marginTop:5, fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace", lineHeight:1.6 }}>{f.c}</div>}
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* ── PAPERS ── */}
      {activeTab === "papers" && (
        <div>
          {/* Sub-tabs: Browse | Saved */}
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {[["browse","🔍 Browse Live"],["saved",`🔖 Saved (${savedPapers.length})`]].map(([id,label]) => (
              <button key={id} onClick={() => setPaperTab(id)} style={{ padding:"6px 16px", borderRadius:6, border:"1px solid", fontSize:12, cursor:"pointer",
                borderColor:paperTab===id?"#C17F3A":"rgba(255,255,255,0.1)",
                background:paperTab===id?"rgba(193,127,58,0.12)":"transparent",
                color:paperTab===id?"#C17F3A":sub }}>{label}</button>
            ))}
          </div>

          {paperTab === "browse" && (
            <>
              {/* Topic quick-filters */}
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
                {QF_TOPICS.map(t => (
                  <button key={t.query} onClick={() => { setPaperQuery(t.query); fetchPapers(t.query) }}
                    style={{ padding:"5px 12px", borderRadius:20, border:"1px solid", fontSize:11, cursor:"pointer",
                      borderColor:paperQuery===t.query?"#C17F3A":"rgba(255,255,255,0.1)",
                      background:paperQuery===t.query?"rgba(193,127,58,0.12)":"transparent",
                      color:paperQuery===t.query?"#C17F3A":sub }}>{t.label}</button>
                ))}
              </div>
              {/* Custom AI search */}
              <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                <input value={aiQuery} onChange={e=>setAiQuery(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&handleAiSearch()}
                  placeholder="Custom topic search, e.g. 'alpha decay', 'order book ML'..."
                  style={{ flex:1, background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 14px", color:txt, fontSize:13, outline:"none" }} />
                <button onClick={handleAiSearch} disabled={loadingPapers}
                  style={{ background:"rgba(193,127,58,0.15)", border:"1px solid rgba(193,127,58,0.3)", borderRadius:8, padding:"8px 18px", color:"#C17F3A", fontSize:13, cursor:"pointer", whiteSpace:"nowrap" }}>
                  {loadingPapers ? "Searching..." : "🔍 Search arXiv"}
                </button>
                <button onClick={() => fetchPapers(paperQuery)} disabled={loadingPapers}
                  style={{ background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:8, padding:"8px 14px", color:"#818cf8", fontSize:13, cursor:"pointer" }}>
                  ↻ Refresh
                </button>
              </div>

              {papers.length === 0 && !loadingPapers && (
                <div style={{ textAlign:"center", padding:"40px 0", color:muted }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>📄</div>
                  <div style={{ fontSize:14, marginBottom:4 }}>No results for this query</div>
                  <div style={{ fontSize:12 }}>Try a different topic or custom search above</div>
                </div>
              )}
              {loadingPapers && (
                <div style={{ textAlign:"center", padding:"40px 0", color:muted }}>
                  <div style={{ fontSize:20, marginBottom:8 }}>⏳</div>
                  <div>Fetching from arXiv...</div>
                </div>
              )}
              {!loadingPapers && papers.map((p, i) => <PaperCard key={i} p={p} />)}
            </>
          )}

          {paperTab === "saved" && (
            <>
              {savedPapers.length === 0 ? (
                <div style={{ textAlign:"center", padding:"48px 0", color:muted }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🔖</div>
                  <div style={{ fontSize:15, color:sub, marginBottom:6 }}>No saved papers yet</div>
                  <div style={{ fontSize:13 }}>Click 📌 on any paper in Browse to save it here</div>
                </div>
              ) : (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                    <span style={{ fontSize:13, color:sub }}>{savedPapers.length} paper{savedPapers.length!==1?"s":""} saved for later reading</span>
                    <button onClick={() => setSavedPapers([])} style={{ fontSize:12, color:"#ef4444", background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:6, padding:"4px 12px", cursor:"pointer" }}>Clear all</button>
                  </div>
                  {savedPapers.map((p, i) => <PaperCard key={i} p={p} showRemove />)}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/components/modules/NetworkingTracker.jsx
// Track firms contacted, people met, competition connections, interview stages
// Data stored in persistent browser storage (useStorage)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const NetworkingTracker = ({ T, aiSettings, markStudyToday = ()=>{} }) => {
  const bg   = T?.cardBg    || "rgba(255,255,255,0.03)"
  const bdr  = T?.cardBorder|| "rgba(255,255,255,0.07)"
  const txt  = T?.text      || "#f1f5f9"
  const sub  = T?.textSub   || "#64748b"
  const muted= T?.textMuted || "#475569"
  const inBg = T?.inputBg   || "rgba(255,255,255,0.04)"
  const selBg= T?.selectBg  || "#111120"

  const [contacts,     setContacts]     = useStorage("networking_contacts_v1", [])
  const [showForm,     setShowForm]     = useState(false)
  const [editId,       setEditId]       = useState(null)
  const [filterStatus, setFilter]       = useState("All")
  const [search,       setSearch]       = useState("")
  const [mainTab,      setMainTab]      = useState("tracker")   // "tracker" | "discover"

  // ── AI Discover state ──
  const [discoverRole,    setDiscoverRole]    = useState("Quantitative Researcher")
  const [discoverFirm,    setDiscoverFirm]    = useState("")
  const [discoverGoal,    setDiscoverGoal]    = useState("Find a mentor who can advise on breaking into HFT")
  const [discoverResults, setDiscoverResults] = useState([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverError,   setDiscoverError]   = useState("")

  const STATUSES      = ["Connected", "Messaged", "Replied", "Coffee Chat", "Referral", "Closed"]
  const STATUS_COLORS = { Connected:"#6366f1", Messaged:"#0ea5e9", Replied:"#C17F3A", "Coffee Chat":"#10b981", Referral:"#C17F3A", Closed:"#475569" }
  const MET_VIA       = ["Competition", "Conference", "LinkedIn", "Cold Email", "Referral", "Event", "AI Discover", "Other"]

  const ROLES = [
    "Quantitative Researcher","Quantitative Trader","Quantitative Developer","HFT Engineer",
    "Portfolio Manager","Risk Quant","Options Trader","Machine Learning Engineer (Finance)",
    "Algorithmic Trader","Data Scientist (Finance)","Financial Engineer","Derivatives Quant",
  ]

  const EMPTY_FORM = { name:"", firm:"", role:"", met_via:"Competition", date:new Date().toISOString().slice(0,10), notes:"", status:"Connected", linkedin:"" }
  const [form, setForm] = useState(EMPTY_FORM)

  const saveContact = () => {
    if (!form.name.trim() || !form.firm.trim()) return
    if (editId) {
      markStudyToday(); setContacts(prev => prev.map(c => c.id === editId ? { ...form, id: editId } : c))
      setEditId(null)
    } else {
      markStudyToday(); setContacts(prev => [{ ...form, id: Date.now().toString() }, ...prev])
    }
    setForm(EMPTY_FORM)
    setShowForm(false)
  }

  const deleteContact = (id) => setContacts(prev => prev.filter(c => c.id !== id))
  const startEdit = (c) => { setForm(c); setEditId(c.id); setShowForm(true); setMainTab("tracker") }

  const filtered = contacts.filter(c => {
    if (filterStatus !== "All" && c.status !== filterStatus) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.firm.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const statCounts = STATUSES.reduce((acc, s) => { acc[s] = contacts.filter(c => c.status === s).length; return acc }, {})

  // ── AI Discover: call Claude to generate targeted quant professionals ──────
  const runDiscover = async () => {
    if (!discoverGoal.trim()) return
    setDiscoverLoading(true)
    setDiscoverError("")
    setDiscoverResults([])
    try {
      const prompt = `You are a quant career coach helping a student find the right people to connect with on LinkedIn.

Student's target role they want to meet: "${discoverRole}"
Specific firm (if any): "${discoverFirm || "any top quant firm"}"
Networking goal: "${discoverGoal}"

Generate 8 realistic LinkedIn profile archetypes for quant finance professionals this student should reach out to. 
These should be realistic professional profiles — NOT real named individuals, but believable archetypes.

Return ONLY a JSON array (no markdown, no preamble). Each object must have exactly:
{
  "name": "First Last (realistic name)",
  "title": "Exact LinkedIn job title",
  "firm": "Real quant firm name",
  "location": "City, Country",
  "background": "1-sentence background (e.g. PhD MIT → Jane Street → Two Sigma)",
  "why_connect": "1 sentence on why connecting with this person would help the student's goal",
  "linkedin_search_query": "Optimised LinkedIn search query string to find this type of person (use keywords, NOT the generated name)",
  "topics_to_mention": ["topic1", "topic2", "topic3"],
  "connection_note": "A ready-to-send 2-sentence LinkedIn connection request note"
}`

      if (!aiSettings?.key) { setDiscoverError("Set your AI key in ⚙ Settings to use AI discovery."); setDiscoverLoading(false); return }
      const raw = await callAI({ prompt, maxTokens: 2000, aiSettings })
      const clean = raw.replace(/```json|```/g,"").trim()
      setDiscoverResults(JSON.parse(clean))
    } catch(e) {
      setDiscoverError("AI search failed — please try again.")
    }
    setDiscoverLoading(false)
  }

  // Build LinkedIn people-search URL from query string
  const linkedInSearchUrl = (query) =>
    `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`

  // Pre-fill add-contact form from a discovered archetype
  const addFromDiscover = (p) => {
    setForm({ ...EMPTY_FORM, role:p.title, firm:p.firm, met_via:"AI Discover",
      notes:`Goal: ${discoverGoal}\nTopics: ${p.topics_to_mention?.join(", ")}\nConnection note: ${p.connection_note}` })
    setMainTab("tracker")
    setShowForm(true)
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:700, color:txt, fontFamily:"'Syne',sans-serif", margin:0 }}>Networking</h1>
          <p style={{ color:sub, margin:"4px 0 0", fontSize:13 }}>{contacts.length} contacts tracked · AI-powered LinkedIn discovery</p>
        </div>
        {mainTab === "tracker" && (
          <button onClick={() => { setShowForm(f => !f); setEditId(null); setForm(EMPTY_FORM) }}
            style={{ padding:"9px 18px", borderRadius:8, border:"1px solid rgba(193,127,58,0.4)", background:"rgba(193,127,58,0.12)", color:"#C17F3A", fontSize:13, cursor:"pointer", fontWeight:600 }}>
            {showForm ? "✕ Cancel" : "+ Add Contact"}
          </button>
        )}
      </div>

      {/* Main tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        {[["tracker",`📋 My Contacts (${contacts.length})`],["discover","✦ AI Discover"]].map(([id,label]) => (
          <button key={id} onClick={() => setMainTab(id)} style={{ padding:"8px 20px", borderRadius:8, border:"1px solid", fontSize:13, cursor:"pointer",
            borderColor: mainTab===id ? "#C17F3A" : bdr,
            background:  mainTab===id ? "rgba(193,127,58,0.12)" : "transparent",
            color:       mainTab===id ? "#C17F3A" : sub }}>{label}</button>
        ))}
      </div>

      {/* ══ TRACKER TAB ══ */}
      {mainTab === "tracker" && (<>
        {/* Status pipeline */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
          {STATUSES.map(s => (
            <div key={s} style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:8, padding:"10px 16px", textAlign:"center", minWidth:90 }}>
              <div style={{ fontSize:22, fontWeight:800, color:STATUS_COLORS[s], fontFamily:"'Syne',sans-serif", lineHeight:1 }}>{statCounts[s]}</div>
              <div style={{ fontSize:10, color:sub, marginTop:3, fontFamily:"'JetBrains Mono',monospace" }}>{s}</div>
            </div>
          ))}
        </div>

        {/* Add / Edit form */}
        {showForm && (
          <div style={{ background:bg, border:`1px solid rgba(193,127,58,0.3)`, borderRadius:12, padding:"20px 24px", marginBottom:20 }}>
            <div style={{ fontSize:12, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", marginBottom:16 }}>{editId ? "✎ EDIT CONTACT" : "+ NEW CONTACT"}</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {[["name","Name *"],["firm","Firm *"],["role","Role"],["linkedin","LinkedIn URL"]].map(([key, label]) => (
                <div key={key}>
                  <div style={{ fontSize:11, color:sub, marginBottom:4 }}>{label}</div>
                  <input value={form[key]} onChange={e => setForm(p => ({...p, [key]:e.target.value}))} placeholder={label}
                    style={{ width:"100%", background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 12px", color:txt, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize:11, color:sub, marginBottom:4 }}>Met Via</div>
                <select value={form.met_via} onChange={e => setForm(p => ({...p, met_via:e.target.value}))}
                  style={{ width:"100%", background:selBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 12px", color:txt, fontSize:13, cursor:"pointer" }}>
                  {MET_VIA.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:sub, marginBottom:4 }}>Status</div>
                <select value={form.status} onChange={e => setForm(p => ({...p, status:e.target.value}))}
                  style={{ width:"100%", background:selBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 12px", color:txt, fontSize:13, cursor:"pointer" }}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:sub, marginBottom:4 }}>Date Met</div>
                <input type="date" value={form.date} onChange={e => setForm(p => ({...p, date:e.target.value}))}
                  style={{ width:"100%", background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 12px", color:txt, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <div style={{ fontSize:11, color:sub, marginBottom:4 }}>Notes</div>
                <textarea value={form.notes} onChange={e => setForm(p => ({...p, notes:e.target.value}))} placeholder="How you met, topics discussed, follow-up needed..."
                  style={{ width:"100%", background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"8px 12px", color:txt, fontSize:13, outline:"none", resize:"vertical", minHeight:72, boxSizing:"border-box", fontFamily:"inherit" }} />
              </div>
            </div>
            <div style={{ marginTop:14, display:"flex", gap:8 }}>
              <button onClick={saveContact} style={{ padding:"9px 24px", borderRadius:8, border:"1px solid rgba(16,185,129,0.4)", background:"rgba(16,185,129,0.15)", color:"#10b981", fontSize:13, cursor:"pointer", fontWeight:600 }}>
                {editId ? "✓ Save Changes" : "✓ Add Contact"}
              </button>
              <button onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM) }}
                style={{ padding:"9px 16px", borderRadius:8, border:`1px solid ${bdr}`, background:"transparent", color:sub, fontSize:13, cursor:"pointer" }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Search + filter */}
        <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or firm..."
            style={{ background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"7px 14px", color:txt, fontSize:13, outline:"none", minWidth:220 }} />
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {["All", ...STATUSES].map(s => (
              <button key={s} onClick={() => setFilter(s)} style={{ padding:"5px 12px", borderRadius:6, border:"1px solid", fontSize:12, cursor:"pointer",
                borderColor: filterStatus===s ? (STATUS_COLORS[s]||"#C17F3A") : bdr,
                background:  filterStatus===s ? `${(STATUS_COLORS[s]||"#C17F3A")}18` : "transparent",
                color:       filterStatus===s ? (STATUS_COLORS[s]||"#C17F3A") : sub }}>{s}</button>
            ))}
          </div>
          <span style={{ fontSize:12, color:muted, marginLeft:"auto" }}>{filtered.length} contacts</span>
        </div>

        {/* Contact list */}
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 0", color:muted }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🤝</div>
            <div style={{ fontSize:15, color:sub, marginBottom:6 }}>No contacts yet</div>
            <div style={{ fontSize:13 }}>Use ✦ AI Discover to find quant professionals to reach out to, or add manually</div>
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {filtered.map(c => {
            const sc = STATUS_COLORS[c.status] || "#6366f1"
            return (
              <div key={c.id} style={{ background:bg, border:`1px solid ${sc}25`, borderRadius:12, padding:"16px 20px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                      <span style={{ fontSize:15, fontWeight:700, color:txt }}>{c.name}</span>
                      <span style={{ fontSize:10, color:sc, background:`${sc}15`, border:`1px solid ${sc}30`, padding:"2px 8px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace" }}>{c.status}</span>
                      <span style={{ fontSize:10, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>via {c.met_via}</span>
                    </div>
                    <div style={{ fontSize:13, color:sub }}>{c.role} · {c.firm}</div>
                    {c.notes && <div style={{ fontSize:12, color:muted, marginTop:6, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{c.notes}</div>}
                    <div style={{ fontSize:10, color:muted, marginTop:4 }}>Met: {formatDate(c.date)}</div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
                    {c.linkedin && (
                      <a href={c.linkedin} target="_blank" rel="noreferrer"
                        style={{ fontSize:11, color:"#0ea5e9", textDecoration:"none", border:"1px solid rgba(14,165,233,0.3)", padding:"4px 10px", borderRadius:6, textAlign:"center" }}>LinkedIn</a>
                    )}
                    <select value={c.status} onChange={e => setContacts(prev => prev.map(x => x.id===c.id ? {...x, status:e.target.value} : x))}
                      style={{ background:selBg, border:`1px solid ${sc}40`, borderRadius:6, padding:"3px 8px", color:sc, fontSize:11, cursor:"pointer" }}>
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                    <button onClick={() => startEdit(c)} style={{ background:"transparent", border:`1px solid ${bdr}`, borderRadius:6, padding:"4px 10px", color:sub, fontSize:11, cursor:"pointer" }}>✎ Edit</button>
                    <button onClick={() => deleteContact(c.id)} style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:6, padding:"4px 10px", color:"#ef4444", fontSize:11, cursor:"pointer" }}>🗑</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </>)}

      {/* ══ AI DISCOVER TAB ══ */}
      {mainTab === "discover" && (
        <div>
          {/* Explainer */}
          <div style={{ background:"rgba(193,127,58,0.06)", border:"1px solid rgba(193,127,58,0.2)", borderRadius:12, padding:"14px 18px", marginBottom:20 }}>
            <div style={{ fontSize:11, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", marginBottom:6, letterSpacing:"0.08em" }}>✦ AI-POWERED LINKEDIN DISCOVERY</div>
            <div style={{ fontSize:12, color:sub, lineHeight:1.6 }}>
              Describe the type of quant professional you want to connect with. Claude generates targeted profile archetypes and opens a pre-built LinkedIn People Search for each — so you can find and reach out immediately.
            </div>
          </div>

          {/* Search form */}
          <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:12, padding:"20px 24px", marginBottom:20 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
              <div>
                <div style={{ fontSize:11, color:sub, marginBottom:6 }}>TARGET ROLE</div>
                <select value={discoverRole} onChange={e => setDiscoverRole(e.target.value)}
                  style={{ width:"100%", background:selBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"9px 12px", color:txt, fontSize:13, cursor:"pointer", outline:"none" }}>
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:sub, marginBottom:6 }}>FIRM (optional)</div>
                <input value={discoverFirm} onChange={e => setDiscoverFirm(e.target.value)} placeholder="e.g. Jane Street, Two Sigma, Citadel..."
                  style={{ width:"100%", background:inBg, border:`1px solid ${bdr}`, borderRadius:8, padding:"9px 12px", color:txt, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <div style={{ fontSize:11, color:sub, marginBottom:6 }}>YOUR NETWORKING GOAL</div>
                <input value={discoverGoal} onChange={e => setDiscoverGoal(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runDiscover()}
                  placeholder="e.g. Find a mentor in HFT, get a referral at Two Sigma, learn about options market making..."
                  style={{ width:"100%", background:inBg, border:`1px solid rgba(193,127,58,0.3)`, borderRadius:8, padding:"9px 12px", color:txt, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <button onClick={runDiscover} disabled={discoverLoading}
              style={{ padding:"10px 28px", borderRadius:8, border:"1px solid rgba(193,127,58,0.4)", background:"rgba(193,127,58,0.15)", color:"#C17F3A", fontSize:14, cursor:"pointer", fontWeight:600 }}>
              {discoverLoading ? "⏳ Generating..." : "✦ Find People to Connect With"}
            </button>
            {discoverError && <div style={{ fontSize:12, color:"#ef4444", marginTop:10 }}>{discoverError}</div>}
          </div>

          {/* Loading state */}
          {discoverLoading && (
            <div style={{ textAlign:"center", padding:"40px 0", color:muted }}>
              <div style={{ fontSize:28, marginBottom:12, animation:"spin 1.5s linear infinite" }}>✦</div>
              <div style={{ fontSize:14, color:sub }}>Claude is finding your ideal networking targets...</div>
            </div>
          )}

          {/* Results */}
          {!discoverLoading && discoverResults.length > 0 && (
            <div>
              <div style={{ fontSize:12, color:"#C17F3A", fontFamily:"'JetBrains Mono',monospace", marginBottom:14 }}>
                ✦ {discoverResults.length} PROFILES FOUND — click LinkedIn Search to find real people matching each archetype
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(380px, 1fr))", gap:14 }}>
                {discoverResults.map((p, i) => (
                  <div key={i} style={{ background:bg, border:`1px solid rgba(99,102,241,0.25)`, borderRadius:12, padding:"18px 20px" }}>
                    {/* Header */}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:10, color:"#6366f1", fontFamily:"'JetBrains Mono',monospace", marginBottom:4, letterSpacing:"0.06em" }}>ARCHETYPE #{i+1}</div>
                        <div style={{ fontSize:15, fontWeight:700, color:txt, marginBottom:2 }}>{p.name}</div>
                        <div style={{ fontSize:12, color:"#6366f1" }}>{p.title}</div>
                        <div style={{ fontSize:12, color:sub, marginTop:1 }}>{p.firm} · {p.location}</div>
                      </div>
                    </div>

                    {/* Background */}
                    <div style={{ fontSize:12, color:sub, lineHeight:1.5, marginBottom:10, padding:"8px 12px", background:bg, borderRadius:7 }}>
                      🎓 {p.background}
                    </div>

                    {/* Why connect */}
                    <div style={{ fontSize:12, color:"#10b981", lineHeight:1.5, marginBottom:10 }}>
                      💡 {p.why_connect}
                    </div>

                    {/* Topics */}
                    {p.topics_to_mention && (
                      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
                        {p.topics_to_mention.map((t, j) => (
                          <span key={j} style={{ fontSize:10, color:"#C17F3A", background:"rgba(193,127,58,0.1)", border:"1px solid rgba(193,127,58,0.2)", padding:"2px 8px", borderRadius:20 }}>{t}</span>
                        ))}
                      </div>
                    )}

                    {/* Connection note preview */}
                    {p.connection_note && (
                      <div style={{ fontSize:11, color:muted, lineHeight:1.5, marginBottom:14, padding:"8px 12px", background:"rgba(99,102,241,0.06)", borderRadius:7, border:"1px solid rgba(99,102,241,0.15)", fontStyle:"italic" }}>
                        "{p.connection_note}"
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display:"flex", gap:8 }}>
                      <a href={linkedInSearchUrl(p.linkedin_search_query)} target="_blank" rel="noreferrer"
                        style={{ flex:1, textAlign:"center", padding:"8px 12px", borderRadius:8, background:"rgba(14,165,233,0.15)", border:"1px solid rgba(14,165,233,0.3)", color:"#0ea5e9", fontSize:12, textDecoration:"none", fontWeight:600 }}>
                        🔍 LinkedIn Search
                      </a>
                      <button onClick={() => addFromDiscover(p)}
                        style={{ flex:1, padding:"8px 12px", borderRadius:8, background:"rgba(16,185,129,0.12)", border:"1px solid rgba(16,185,129,0.3)", color:"#10b981", fontSize:12, cursor:"pointer", fontWeight:600 }}>
                        + Track Contact
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!discoverLoading && discoverResults.length === 0 && (
            <div style={{ textAlign:"center", padding:"60px 0", color:muted }}>
              <div style={{ fontSize:40, marginBottom:12 }}>◎</div>
              <div style={{ fontSize:15, color:sub, marginBottom:6 }}>Ready to discover your network</div>
              <div style={{ fontSize:13 }}>Fill in your goal above and click "Find People to Connect With"</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/constants/config.js  (when splitting into separate files)
// Contains: NAV_ITEMS, theme tokens
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/data/roadmapTracks.js
// ROADMAP_TRACKS: target roles → required skills, course IDs, competitions, firms
// To add a track: append a new object. To add a milestone: append to milestones[].
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ROADMAP_TRACKS = {
  qr: {
    id: "qr",
    title: "Quantitative Researcher",
    icon: "◉",
    color: "#C17F3A",
    desc: "Build alpha signals, statistical models and research systematic strategies at a hedge fund or prop shop.",
    timeline: "18–24 months",
    // Priority-A course IDs most relevant to this track
    courses: ["m0","m1","m2","m3","m4","m5","ml0","ml1","ml2","ml3","ml4","f0","f1","f7","f16","f18","f22","p0","c0","c7","c10","c20"],
    interview_cats: ["Probability & Stats","ML for Finance","Options & Derivatives","Brainteasers"],
    comp_keywords: ["research","alpha","quant","kaggle","data","ML"],
    firms: ["Jane Street","Two Sigma","D.E. Shaw","Renaissance Technologies","AQR Capital","Man Group","Citadel","Millennium Management","Cubist Systematic"],
    milestones: [
      { id:"ms_qr1", label:"Complete core probability & statistics sequence",   courses:["m0","m1","m2","m3","c1","c7"] },
      { id:"ms_qr2", label:"Complete ML foundations (supervised + unsupervised)",courses:["ml0","ml1","ml2","ml3","ml4"] },
      { id:"ms_qr3", label:"Complete quantitative finance sequence",             courses:["f0","f1","f7","f16","f18","f22"] },
      { id:"ms_qr4", label:"Enter a quant research competition",                courses:[] },
      { id:"ms_qr5", label:"Score 8+/10 on 3 consecutive interview sessions",   courses:[] },
      { id:"ms_qr6", label:"Network with 5 QR professionals",                   courses:[] },
    ],
  },
  qt: {
    id: "qt",
    title: "Quantitative Trader",
    icon: "⬡",
    color: "#10b981",
    desc: "Execute trades, manage risk and build intuition for pricing and market microstructure at a trading firm.",
    timeline: "12–18 months",
    courses: ["m0","m1","m2","m3","m4","f0","f1","f2","f3","f4","f7","f13","f16","f18","c10","c13","c20","p0"],
    interview_cats: ["Options & Derivatives","Market Making & Trading","Brainteasers","Probability & Stats"],
    comp_keywords: ["trading","market making","options","simulation","competition"],
    firms: ["Jane Street","Optiver","IMC Trading","SIG","Citadel Securities","Virtu Financial","Hudson River Trading","Jump Trading"],
    milestones: [
      { id:"ms_qt1", label:"Complete probability & statistics foundations",      courses:["m0","m1","m2","m3"] },
      { id:"ms_qt2", label:"Complete derivatives & options sequence",            courses:["f0","f1","f2","f3","f4","f13"] },
      { id:"ms_qt3", label:"Complete applied finance & microstructure",          courses:["f7","f16","f18","c13"] },
      { id:"ms_qt4", label:"Enter a trading competition (IMC, Optiver, SIG)",    courses:[] },
      { id:"ms_qt5", label:"Score 8+/10 on Options & Market Making interviews",  courses:[] },
      { id:"ms_qt6", label:"Network with 5 traders at target firms",             courses:[] },
    ],
  },
  qd: {
    id: "qd",
    title: "Quant Developer / SWE",
    icon: "▣",
    color: "#6366f1",
    desc: "Build low-latency trading infrastructure, execution systems and research tooling in C++ and Python.",
    timeline: "12–18 months",
    courses: ["c0","c3","c4","c8","c9","c10","c15","c16","c20","p0","p1","p2","p3","p4","m0","m1","f22"],
    interview_cats: ["Python & Algorithms","Brainteasers","Probability & Stats"],
    comp_keywords: ["programming","algorithms","competitive","ICPC","HFT","systems"],
    firms: ["Citadel Securities","Hudson River Trading","Optiver","Jump Trading","Squarepoint Capital","Two Sigma","Virtu Financial"],
    milestones: [
      { id:"ms_qd1", label:"Complete computer systems & architecture sequence",  courses:["c3","c4","c8","c15","c16"] },
      { id:"ms_qd2", label:"Complete algorithms & performance engineering",       courses:["c10","c20","p0","p1","p2"] },
      { id:"ms_qd3", label:"Complete parallel & distributed systems",            courses:["c9","c16"] },
      { id:"ms_qd4", label:"Solve 50+ LeetCode medium/hard problems",           courses:[] },
      { id:"ms_qd5", label:"Enter a competitive programming contest",            courses:[] },
      { id:"ms_qd6", label:"Build a live trading system project",                courses:[] },
    ],
  },
  risk: {
    id: "risk",
    title: "Risk Quant",
    icon: "◎",
    color: "#ec4899",
    desc: "Model, measure and manage financial risk — market risk, credit risk and counterparty exposure.",
    timeline: "12–18 months",
    courses: ["m0","m1","m2","m3","m5","f0","f1","f3","f7","f13","f14","f16","f18","ml0","ml1","c1","c7"],
    interview_cats: ["Probability & Stats","Options & Derivatives","ML for Finance"],
    comp_keywords: ["risk","quantitative","finance","portfolio","modelling"],
    firms: ["Goldman Sachs","J.P. Morgan","Morgan Stanley","Barclays","Citadel","AQR Capital","Man Group","Millennium Management"],
    milestones: [
      { id:"ms_rk1", label:"Complete probability & stochastic processes",        courses:["m0","m1","m2","m3","m5","c1"] },
      { id:"ms_rk2", label:"Complete derivatives pricing & risk management",     courses:["f0","f1","f3","f13","f18"] },
      { id:"ms_rk3", label:"Complete econometrics & financial modelling",        courses:["f7","f14","f16","ml0","ml1"] },
      { id:"ms_rk4", label:"Enter a finance modelling competition",              courses:[] },
      { id:"ms_rk5", label:"Score 8+/10 on Probability & Stats interviews",     courses:[] },
      { id:"ms_rk6", label:"Network with 5 risk professionals",                 courses:[] },
    ],
  },
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MODULE: CAREER ROADMAP
// Personalized career OS — pick a target role, see exactly what to do next
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CareerRoadmap = ({ T, courseProgress, navigate, isMobile, isTablet, aiSettings, userContext }) => {
  const bg    = T?.cardBg    || "rgba(255,255,255,0.04)"
  const bdr   = T?.cardBorder|| "rgba(255,255,255,0.08)"
  const txt   = T?.text      || "#f1f5f9"
  const sub   = T?.textSub   || "#64748b"
  const muted = T?.textMuted || "#475569"
  const inBg  = T?.inputBg   || "rgba(255,255,255,0.055)"

  const [track,        setTrack]       = useStorage("roadmap_track_v1", "qr")
  const [aiAdvice,     setAiAdvice]    = useState("")
  const [aiLoading,    setAiLoading]   = useState(false)
  const [expanded,     setExpanded]    = useState(null)   // expanded milestone id

  const t     = ROADMAP_TRACKS[track]
  const color = t.color

  // ── Per-track course completion ──────────────────────────────────────────────
  const trackCourses = t.courses.map(id => COURSES.find(c => c.id === id)).filter(Boolean)
  const doneCourses  = trackCourses.filter(c => courseProgress[c.id] === 1)
  const pct          = trackCourses.length ? Math.round(doneCourses.length / trackCourses.length * 100) : 0

  // ── Milestone completion ─────────────────────────────────────────────────────
  const milestoneProgress = (ms) => {
    if (!ms.courses.length) return null   // manual milestone — no auto tracking
    const done = ms.courses.filter(id => courseProgress[id] === 1).length
    return { done, total: ms.courses.length, pct: Math.round(done / ms.courses.length * 100) }
  }

  // ── Relevant open competitions ────────────────────────────────────────────────
  const relevantComps = COMPETITIONS.filter(c =>
    c.status !== "closed" &&
    t.comp_keywords.some(kw => (c.name+c.desc+c.category).toLowerCase().includes(kw.toLowerCase()))
  ).slice(0, 5)

  // ── Relevant job openings ─────────────────────────────────────────────────────
  const relevantJobs = JOBS.filter(j =>
    j.status !== "closed" &&
    (t.firms.includes(j.company) || j.type === (track==="qr"?"QR":track==="qt"?"QT":track==="qd"?"QD":"Risk"))
  ).slice(0, 6)

  // ── AI "What next?" ──────────────────────────────────────────────────────────
  const getAiAdvice = async () => {
    setAiLoading(true); setAiAdvice("")
    const completedNames = doneCourses.map(c => c.name).join(", ") || "none yet"
    const remainingNames = trackCourses.filter(c => courseProgress[c.id] !== 1).slice(0, 8).map(c => c.name).join(", ")
    try {
      if (!aiSettings?.key) { setAiAdvice("Set your AI provider key in ⚙ Settings to get personalised advice."); setAiLoading(false); return }
      const uc = userContext || {}
      const prompt = `You are a senior quant hiring manager. A student has asked for honest, specific next-step advice. Here is their full profile:

TARGET ROLE: ${t.title}
TRACK PROGRESS: ${pct}% of track courses complete (${doneCourses.length}/${trackCourses.length} courses)
COMPLETED COURSES: ${completedNames || "none yet"}
STILL NEEDED: ${remainingNames || "all done"}

STUDY HABITS:
- Current streak: ${uc.streak || 0} day(s)
- Total study days logged: ${uc.totalStudyDays || 0}
- Days since last study session: ${uc.daysSinceStudy === null ? "never logged" : uc.daysSinceStudy === 0 ? "studied today" : `${uc.daysSinceStudy} days ago`}
- Lectures completed: ${uc.doneLectures || 0} across all courses

INTERVIEW PRACTICE:
- Total sessions: ${uc.totalSessions || 0}
- Average score: ${uc.avgScore ? `${uc.avgScore}/10` : "no sessions yet"}
- Weak categories: ${uc.weakCategories?.length ? uc.weakCategories.join(", ") : "none identified yet"}
- Strong categories: ${uc.strongCategories?.length ? uc.strongCategories.join(", ") : "none yet"}

COURSE REVIEWS:
- Overdue reviews: ${uc.overdueReviews || 0}
- Upcoming reviews scheduled: ${uc.upcomingReviews || 0}

NETWORKING:
- Total contacts added: ${uc.totalContacts || 0}
- Overdue follow-ups: ${uc.overdueFollowups || 0}

APPLICATIONS:
- Competitions: ${uc.appSummary?.competitions?.applied || 0} applied, ${uc.appSummary?.competitions?.interviewing || 0} interviewing
- Jobs/internships: ${uc.appSummary?.jobs?.applied || 0} applied, ${uc.appSummary?.jobs?.interviewing || 0} interviewing

Based on this full picture, give ONE specific, honest, actionable piece of advice. 3-4 sentences max. Be direct — tell them exactly what to do next and why it matters most right now given their actual situation. If they haven't studied in days, say so. If their interview scores are weak, address that. Treat them like an intelligent adult who wants real feedback, not encouragement.`

      const advice = await callAI({
        system: "You are a senior quant hiring manager giving honest, direct career advice. No fluff, no generic tips. Respond based on the specific data provided.",
        prompt,
        maxTokens: 400, aiSettings
      })
      setAiAdvice(advice || "Could not load advice.")
    } catch { setAiAdvice("AI advisor unavailable. Focus on the next incomplete milestone below.") }
    setAiLoading(false)
  }

  // ── Radial progress ring ─────────────────────────────────────────────────────
  const R = 36, C = 40, circ = 2 * Math.PI * R
  const dash = (pct / 100) * circ

  return (
    <div style={{ padding: "0 0 40px", width: "100%", boxSizing: "border-box", overflowX: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 28, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: txt, fontFamily: "'Syne',sans-serif", margin: 0 }}>Career Roadmap</h1>
          <p style={{ color: sub, margin: "4px 0 0", fontSize: 13 }}>
            Your personalised path from student to quant — pick a target role and follow the steps
          </p>
        </div>
      </div>

      {/* ── Track selector ── */}
      {(isMobile||isTablet) ? (
        /* Mobile: compact horizontal chips */
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 20, paddingBottom: 4,
          width: "100%", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {Object.values(ROADMAP_TRACKS).map(tr => (
            <button key={tr.id} onClick={() => { setTrack(tr.id); setAiAdvice("") }}
              style={{
                flexShrink: 0, padding: "8px 14px", borderRadius: 20, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
                border: `1px solid ${track === tr.id ? tr.color : bdr}`,
                background: track === tr.id ? `${tr.color}15` : bg,
                transition: "all 0.2s",
              }}>
              <span style={{ fontSize: 14 }}>{tr.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: track === tr.id ? tr.color : txt, whiteSpace: "nowrap" }}>{tr.title}</span>
            </button>
          ))}
        </div>
      ) : (
        /* Desktop: full cards */
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 28 }}>
          {Object.values(ROADMAP_TRACKS).map(tr => (
            <button key={tr.id} onClick={() => { setTrack(tr.id); setAiAdvice("") }}
              style={{
                padding: "12px 20px", borderRadius: 12, cursor: "pointer", textAlign: "left", minWidth: 180,
                border: `1px solid ${track === tr.id ? tr.color : bdr}`,
                background: track === tr.id ? `${tr.color}12` : bg,
                transition: "all 0.2s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 16, color: track === tr.id ? tr.color : muted }}>{tr.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: track === tr.id ? tr.color : txt }}>{tr.title}</span>
              </div>
              <div style={{ fontSize: 10, color: muted, lineHeight: 1.5 }}>{tr.timeline}</div>
            </button>
          ))}
        </div>
      )}

      {/* ── Main 2-col layout ── */}
      <div style={{ display: "grid", gridTemplateColumns: (isMobile||isTablet)?"1fr":"1fr 340px", gap: 20, alignItems: "start", width: "100%" }}>

        {/* ── LEFT: milestones + course checklist ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", minWidth: 0 }}>

          {/* Track hero card */}
          <div style={{ background: bg, border: `1px solid ${color}25`, borderRadius: 16, padding: (isMobile||isTablet) ? "14px 16px" : "22px 26px", borderLeft: `4px solid ${color}`, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: (isMobile||isTablet) ? 14 : 20, minWidth: 0 }}>
              {/* Progress ring */}
              <svg width={C*2} height={C*2} style={{ flexShrink: 0 }}>
                <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(128,128,128,0.15)" strokeWidth={7} />
                <circle cx={C} cy={C} r={R} fill="none" stroke={color} strokeWidth={7}
                  strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ/4}
                  strokeLinecap="round" style={{ transition: "stroke-dasharray 1s ease" }} />
                <text x={C} y={C+1} textAnchor="middle" dominantBaseline="middle"
                  fontSize={15} fontWeight={800} fill={color} fontFamily="'Syne',sans-serif">{pct}%</text>
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: (isMobile||isTablet) ? 15 : 18, fontWeight: 800, color: txt, fontFamily: "'Syne',sans-serif", marginBottom: 4,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                {!(isMobile||isTablet) && <div style={{ fontSize: 12, color: sub, lineHeight: 1.5, marginBottom: 8,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.desc}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: color, background: `${color}12`, border: `1px solid ${color}25`, padding: "3px 10px", borderRadius: 20, fontFamily: "'JetBrains Mono',monospace" }}>⏱ {t.timeline}</span>
                  <span style={{ fontSize: 10, color: "#10b981", background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.2)", padding: "3px 10px", borderRadius: 20, fontFamily: "'JetBrains Mono',monospace" }}>{doneCourses.length}/{trackCourses.length} courses</span>
                </div>
              </div>
            </div>
          </div>

          {/* AI Advisor */}
          <div style={{ background: bg, border: `1px solid rgba(193,127,58,0.15)`, borderRadius: 14, padding: (isMobile||isTablet) ? "12px 14px" : "18px 22px" }}>
            <div style={{ display: "flex", alignItems: (isMobile||isTablet) ? "flex-start" : "center", flexDirection: (isMobile||isTablet) ? "column" : "row", gap: isMobile ? 8 : 0, justifyContent: "space-between", marginBottom: aiAdvice ? 12 : 0 }}>
              <div style={{ fontSize: 11, color: "#C17F3A", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'JetBrains Mono',monospace" }}>
                ✦ AI Career Advisor
              </div>
              <button onClick={getAiAdvice} disabled={aiLoading}
                style={{ padding: "6px 16px", borderRadius: 8, border: "1px solid rgba(193,127,58,0.3)", background: "rgba(193,127,58,0.08)", color: "#C17F3A", fontSize: 11, cursor: aiLoading ? "wait" : "pointer", fontFamily: "'JetBrains Mono',monospace", transition: "all 0.2s" }}>
                {aiLoading ? "Thinking…" : aiAdvice ? "↺ Refresh" : "What should I do next? →"}
              </button>
            </div>
            {aiAdvice && (
              <div style={{ fontSize: 13, color: sub, lineHeight: 1.8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12, fontStyle: "italic" }}>
                "{aiAdvice}"
              </div>
            )}
          </div>

          {/* Milestones */}
          <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 14, padding: isMobile ? "12px 14px" : "18px 22px" }}>
            <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16, fontFamily: "'JetBrains Mono',monospace" }}>
              🗺 Milestones
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {t.milestones.map((ms, idx) => {
                const mp   = milestoneProgress(ms)
                const done = mp ? mp.pct === 100 : false
                const isOpen = expanded === ms.id
                return (
                  <div key={ms.id} style={{ borderRadius: 10, border: `1px solid ${done ? `${color}30` : T?.rowBorder||"rgba(0,0,0,0.06)"}`, overflow: "hidden" }}>
                    <div onClick={() => setExpanded(isOpen ? null : ms.id)}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", background: done ? `${color}08` : "transparent" }}>
                      {/* Status dot */}
                      <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        background: done ? color : T?.rowBg||"rgba(0,0,0,0.04)", border: `1px solid ${done ? color : T?.border||"rgba(0,0,0,0.10)"}` }}>
                        {done ? <span style={{ fontSize: 11, color: "#000" }}>✓</span>
                          : <span style={{ fontSize: 10, color: muted, fontFamily: "'JetBrains Mono',monospace" }}>{idx+1}</span>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: done ? color : txt, fontWeight: done ? 600 : 400, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ms.label}</div>
                        {mp && (
                          <div style={{ marginTop: 5, height: 3, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 3, background: done ? color : `linear-gradient(90deg,${color}99,${color})`, width: `${mp.pct}%`, transition: "width 0.8s ease" }} />
                          </div>
                        )}
                      </div>
                      {mp && <span style={{ fontSize: 10, color: done ? color : muted, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{mp.done}/{mp.total}</span>}
                      <span style={{ fontSize: 10, color: muted }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                    {/* Expanded: show courses in this milestone */}
                    {isOpen && ms.courses.length > 0 && (
                      <div style={{ padding: "0 16px 14px", borderTop: `1px solid ${T?.rowBorder||"rgba(0,0,0,0.06)"}` }}>
                        {ms.courses.map(cid => {
                          const c = COURSES.find(x => x.id === cid); if (!c) return null
                          const status = courseProgress[c.id]
                          const isDone = status === 1
                          return (
                            <div key={cid} onClick={() => navigate("learning")}
                              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", cursor: "pointer", borderBottom: `1px solid ${T?.rowBorder||"rgba(0,0,0,0.04)"}` }}>
                              <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                                background: isDone ? `${color}25` : T?.rowBg||"rgba(0,0,0,0.04)", border: `1px solid ${isDone ? color+"50" : T?.border||"rgba(0,0,0,0.10)"}` }}>
                                {isDone && <span style={{ fontSize: 9, color: color }}>✓</span>}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: isDone ? sub : txt, textDecoration: isDone ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                                <div style={{ fontSize: 9, color: muted, fontFamily: "'JetBrains Mono',monospace" }}>{c.code} · {c.institution}</div>
                              </div>
                              <span style={{ fontSize: 10, color: SUBJECT_COLORS[c.subject] || color, background: `${SUBJECT_COLORS[c.subject]||color}12`, padding: "2px 6px", borderRadius: 4, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{c.subject}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {isOpen && !ms.courses.length && (
                      <div style={{ padding: "10px 16px 14px", fontSize: 12, color: sub, borderTop: `1px solid ${T?.rowBorder||"rgba(0,0,0,0.06)"}` }}>
                        Track this milestone manually — check it off when achieved.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Full course checklist */}
          <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 14, padding: isMobile ? "12px 14px" : "18px 22px" }}>
            <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>
              📚 Core Course Checklist ({doneCourses.length}/{trackCourses.length})
            </div>
            {isMobile ? (
              /* Mobile: one horizontal scroll strip per subject */
              (() => {
                const bySubject = Object.keys(SUBJECT_COLORS).map(subj => ({
                  subj,
                  col: SUBJECT_COLORS[subj],
                  courses: trackCourses.filter(c => c.subject === subj),
                })).filter(g => g.courses.length > 0)
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {bySubject.map(({ subj, col, courses }) => (
                      <div key={subj}>
                        {/* Subject label */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }}/>
                          <span style={{ fontSize: 10, color: col, fontFamily: "'JetBrains Mono',monospace",
                            textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{subj}</span>
                          <span style={{ fontSize: 9, color: muted, marginLeft: 4 }}>
                            {courses.filter(c => courseProgress[c.id] === 1).length}/{courses.length}
                          </span>
                        </div>
                        {/* Horizontal scroll row */}
                        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4,
                          width: "100%", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
                          {courses.map(c => {
                            const status = courseProgress[c.id]
                            const isDone = status === 1
                            const isIP   = status === 0.5
                            return (
                              <div key={c.id} onClick={() => navigate("learning")}
                                style={{ flexShrink: 0, width: 130, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                                  display: "flex", alignItems: "center", gap: 7,
                                  background: isDone ? `${col}10` : isIP ? `${col}07` : bg,
                                  border: `1px solid ${isDone ? col+"35" : isIP ? col+"25" : T?.rowBorder||"rgba(0,0,0,0.06)"}`,
                                  opacity: isDone ? 0.75 : 1 }}>
                                {/* Checkbox */}
                                <div style={{ width: 13, height: 13, borderRadius: 3, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                                  background: isDone ? col : isIP ? `${col}30` : "transparent",
                                  border: `1.5px solid ${isDone ? col : isIP ? col+"80" : T?.border||"rgba(0,0,0,0.15)"}` }}>
                                  {isDone && <span style={{ fontSize: 7, color: "#000" }}>✓</span>}
                                  {isIP  && <span style={{ fontSize: 7, color: col }}>◑</span>}
                                </div>
                                {/* Name + code stacked */}
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 10, color: isDone ? sub : txt,
                                    textDecoration: isDone ? "line-through" : "none",
                                    lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {c.name}
                                  </div>
                                  <div style={{ fontSize: 8, color: muted, fontFamily: "'JetBrains Mono',monospace", marginTop: 1 }}>{c.code}</div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()
            ) : (
              /* Desktop: 2-col grid */
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 6 }}>
                {trackCourses.map(c => {
                  const status = courseProgress[c.id]
                  const isDone = status === 1
                  const isIP   = status === 0.5
                  const col    = SUBJECT_COLORS[c.subject] || color
                  return (
                    <div key={c.id} onClick={() => navigate("learning")}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                        background: isDone ? `${col}08` : T?.rowBg||"rgba(0,0,0,0.02)",
                        border: `1px solid ${isDone ? col+"25" : T?.rowBorder||"rgba(0,0,0,0.05)"}`,
                        opacity: isDone ? 0.8 : 1 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, background: isDone ? col : isIP ? `${col}30` : "transparent", border: `1.5px solid ${isDone ? col : isIP ? col+"80" : T?.border||"rgba(0,0,0,0.15)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {isDone && <span style={{ fontSize: 8, color: "#000" }}>✓</span>}
                        {isIP  && <span style={{ fontSize: 8, color: col }}>◑</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: isDone ? sub : txt, textDecoration: isDone ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>{c.name}</div>
                        <div style={{ fontSize: 9, color: muted }}>{c.code}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>

        {/* ── RIGHT sidebar: interview focus, competitions, firms ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", minWidth: 0 }}>

          {/* Interview focus */}
          <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 14, padding: (isMobile||isTablet) ? "12px 14px" : "18px 20px" }}>
            <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>
              ◉ Interview Focus
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {t.interview_cats.map((cat, i) => (
                <div key={cat} onClick={() => navigate("interview")}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, cursor: "pointer",
                    background: i === 0 ? `${color}10` : T?.rowBg||"rgba(0,0,0,0.025)",
                    border: `1px solid ${i === 0 ? color+"30" : "rgba(255,255,255,0.06)"}` }}>
                  <span style={{ fontSize: 11, color: i === 0 ? color : muted, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>#{i+1}</span>
                  <span style={{ fontSize: 12, color: i === 0 ? txt : sub }}>{cat}</span>
                  {i === 0 && <span style={{ marginLeft: "auto", fontSize: 9, color: color }}>PRIMARY →</span>}
                </div>
              ))}
            </div>
            <button onClick={() => navigate("interview")}
              style={{ marginTop: 12, width: "100%", padding: "8px", borderRadius: 8, border: `1px solid ${color}30`, background: `${color}08`, color: color, fontSize: 11, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>
              Practice now →
            </button>
          </div>

          {/* Relevant competitions */}
          <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 14, padding: (isMobile||isTablet) ? "12px 14px" : "18px 20px" }}>
            <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>
              ⬡ Relevant Competitions
            </div>
            {relevantComps.length === 0 && <div style={{ fontSize: 12, color: muted }}>No open competitions right now.</div>}
            {relevantComps.map(c => (
              <div key={c.id} style={{ marginBottom: 8, padding: "9px 12px", borderRadius: 8, background: T?.rowBg||"rgba(0,0,0,0.025)", border: `1px solid ${T?.rowBorder||"rgba(0,0,0,0.06)"}` }}>
                <div style={{ fontSize: 12, color: txt, fontWeight: 600, marginBottom: 2 }}>{c.name}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, color: muted }}>{c.category}</span>
                  <a href={c.link} target="_blank" rel="noreferrer"
                    style={{ fontSize: 10, color: "#C17F3A", textDecoration: "none", border: "1px solid rgba(193,127,58,0.25)", padding: "2px 8px", borderRadius: 4 }}>Apply →</a>
                </div>
              </div>
            ))}
            <button onClick={() => navigate("competitions")}
              style={{ marginTop: 4, width: "100%", padding: "7px", borderRadius: 8, border: "1px solid rgba(193,127,58,0.2)", background: "rgba(193,127,58,0.06)", color: "#C17F3A", fontSize: 11, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>
              All competitions →
            </button>
          </div>

          {/* Target firms & open roles */}
          <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 14, padding: (isMobile||isTablet) ? "12px 14px" : "18px 20px" }}>
            <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>
              🏢 Target Firms
            </div>
            {relevantJobs.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: muted, marginBottom: 6 }}>Open roles now:</div>
                {relevantJobs.map(j => (
                  <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "7px 10px", borderRadius: 7, background: `${color}08`, border: `1px solid ${color}18` }}>
                    <span style={{ fontSize: 9, color: color, background: `${color}18`, padding: "2px 6px", borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{j.type}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.company}</div>
                      <div style={{ fontSize: 9, color: muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.role}</div>
                    </div>
                    <a href={j.link} target="_blank" rel="noreferrer"
                      style={{ fontSize: 10, color: color, textDecoration: "none", flexShrink: 0 }}>→</a>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {t.firms.slice(0, relevantJobs.length > 0 ? 4 : 8).map(firm => (
                <div key={firm} style={{ fontSize: 12, color: sub, padding: "5px 8px", borderRadius: 6, background: T?.rowBg||"rgba(0,0,0,0.025)", border: `1px solid ${T?.rowBorder||"rgba(0,0,0,0.05)"}` }}>
                  {firm}
                </div>
              ))}
            </div>
            <button onClick={() => navigate("competitions")}
              style={{ marginTop: 10, width: "100%", padding: "7px", borderRadius: 8, border: `1px solid ${color}20`, background: `${color}06`, color: color, fontSize: 11, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>
              Browse open roles →
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Custom SVG nav icons ────────────────────────────────────────────────────
const NavIcon = ({ id, color, size = 22 }) => {
  const s = { width:size, height:size, display:"block" }
  const p = { fill:"none", stroke:color, strokeWidth:1.5, strokeLinecap:"round", strokeLinejoin:"round" }
  switch(id) {
    case "dashboard": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <polygon points="12,2 22,9 18,21 6,21 2,9"/>
        <circle cx="12" cy="12" r="2.5" fill={color} stroke="none"/>
        <line x1="12" y1="2" x2="12" y2="9.5"/>
        <line x1="22" y1="9" x2="14.5" y2="11"/>
        <line x1="18" y1="21" x2="13.5" y2="13.5"/>
        <line x1="6" y1="21" x2="10.5" y2="13.5"/>
        <line x1="2" y1="9" x2="9.5" y2="11"/>
      </svg>)
    case "roadmap": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <line x1="12" y1="21" x2="12" y2="14"/>
        <line x1="12" y1="14" x2="6" y2="8"/>
        <line x1="12" y1="14" x2="18" y2="8"/>
        <line x1="6" y1="8" x2="4" y2="3"/>
        <line x1="6" y1="8" x2="9" y2="3"/>
        <line x1="18" y1="8" x2="15" y2="3"/>
        <line x1="18" y1="8" x2="20" y2="3"/>
        <circle cx="12" cy="21" r="1.5" fill={color} stroke="none"/>
        <circle cx="6" cy="8" r="1.5" fill={color} stroke="none"/>
        <circle cx="18" cy="8" r="1.5" fill={color} stroke="none"/>
      </svg>)
    case "learning": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <path d="M2 6 C2 6 7 5 12 7 C17 5 22 6 22 6 L22 19 C22 19 17 18 12 20 C7 18 2 19 2 19 Z"/>
        <line x1="12" y1="7" x2="12" y2="20"/>
        <line x1="7" y1="12" x2="11" y2="12"/>
        <line x1="7" y1="14.5" x2="11" y2="14.5"/>
        <line x1="13" y1="12" x2="17" y2="12"/>
        <line x1="13" y1="14.5" x2="17" y2="14.5"/>
      </svg>)
    case "competitions": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <path d="M8 3 L16 3 L16 13 C16 16.3 14.2 18 12 18 C9.8 18 8 16.3 8 13 Z"/>
        <path d="M5 5 L8 5 L8 11 C6.3 11 5 9.5 5 8 Z"/>
        <path d="M19 5 L16 5 L16 11 C17.7 11 19 9.5 19 8 Z"/>
        <line x1="9" y1="18" x2="9" y2="21"/>
        <line x1="15" y1="18" x2="15" y2="21"/>
        <line x1="7" y1="21" x2="17" y2="21"/>
      </svg>)
    case "career": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <rect x="2" y="8" width="20" height="13" rx="2"/>
        <path d="M8 8 L8 5 C8 3.9 8.9 3 10 3 L14 3 C15.1 3 16 3.9 16 5 L16 8"/>
        <line x1="2" y1="14" x2="22" y2="14"/>
        <line x1="12" y1="14" x2="12" y2="17"/>
      </svg>)
    case "interview": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <path d="M3 5 C3 3.9 3.9 3 5 3 L19 3 C20.1 3 21 3.9 21 5 L21 15 C21 16.1 20.1 17 19 17 L8 17 L3 21 L3 5 Z"/>
        <circle cx="8" cy="10" r="1.2" fill={color} stroke="none"/>
        <circle cx="12" cy="10" r="1.2" fill={color} stroke="none"/>
        <circle cx="16" cy="10" r="1.2" fill={color} stroke="none"/>
      </svg>)
    case "networking": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <circle cx="12" cy="12" r="2.5"/>
        <circle cx="4" cy="6" r="2"/>
        <circle cx="20" cy="6" r="2"/>
        <circle cx="4" cy="18" r="2"/>
        <circle cx="20" cy="18" r="2"/>
        <line x1="9.6" y1="10.5" x2="5.8" y2="7.7"/>
        <line x1="14.4" y1="10.5" x2="18.2" y2="7.7"/>
        <line x1="9.6" y1="13.5" x2="5.8" y2="16.3"/>
        <line x1="14.4" y1="13.5" x2="18.2" y2="16.3"/>
      </svg>)
    case "resources": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <rect x="4" y="15" width="16" height="6" rx="1"/>
        <rect x="5" y="9" width="14" height="6" rx="1"/>
        <rect x="6" y="3" width="12" height="6" rx="1"/>
        <line x1="8" y1="3" x2="8" y2="9"/>
        <line x1="8" y1="9" x2="8" y2="15"/>
      </svg>)
    case "skilltree": return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <circle cx="12" cy="20" r="2"/>
        <line x1="12" y1="18" x2="12" y2="14"/>
        <line x1="12" y1="14" x2="7" y2="10"/>
        <line x1="12" y1="14" x2="17" y2="10"/>
        <circle cx="7" cy="10" r="1.8"/>
        <line x1="7" y1="8.2" x2="4" y2="5"/>
        <line x1="7" y1="8.2" x2="10" y2="5"/>
        <circle cx="4" cy="4" r="1.5" fill={color} stroke="none"/>
        <circle cx="10" cy="4" r="1.5" fill={color} stroke="none"/>
        <circle cx="17" cy="10" r="1.8"/>
        <line x1="17" y1="8.2" x2="14" y2="5"/>
        <line x1="17" y1="8.2" x2="20" y2="5"/>
        <circle cx="14" cy="4" r="1.5" fill={color} stroke="none"/>
        <circle cx="20" cy="4" r="1.5" fill={color} stroke="none"/>
      </svg>)
    default: return <span style={{ fontSize:17, color }}>{id}</span>
  }
}

const NAV_ITEMS = [
  { id:"dashboard",    label:"Dashboard" },
  { id:"roadmap",      label:"Career Roadmap" },
  { id:"learning",     label:"Learning Path" },
  { id:"competitions", label:"Competitions" },
  { id:"career",       label:"Career Prep",   mobileOnly:true  },
  { id:"interview",    label:"Practice",      desktopOnly:true },
  { id:"networking",   label:"Networking",    desktopOnly:true },
  { id:"resources",    label:"Resource Hub" },
]

// ─────────────────────────────────────────────
//  GOOGLE AUTH COMPONENT
// ─────────────────────────────────────────────
const AVATARS = ["🧑‍💻","👩‍💻","🧑‍🔬","👩‍🔬","🧑‍🎓","👩‍🎓","🦊","🐺","🦁","🐯","🦅","🐉"]

const WelcomeScreen = ({ onLogin, isDark }) => {
  const [name, setName]     = useState("")
  const [avatar, setAvatar] = useState("🧑‍💻")
  const [step, setStep]     = useState(0) // 0=intro, 1=setup

  const text = "#E8D5C0"
  const sub  = "#9A7A62"
  const bdr  = "rgba(180, 90, 40, 0.22)"
  const card = "rgba(255,255,255,0.04)"

  const bgMesh = `#110703`

  const handleStart = () => {
    const finalName = name.trim() || "Quant Student"
    onLogin({ name: finalName, avatar, email: null, picture: null })
  }

  return (
    <div style={{ minHeight:"100vh", width:"100%", background:bgMesh, display:"flex", alignItems:"center",
      justifyContent:"center", fontFamily:"'DM Sans',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap');
        html, body, #root { margin: 0; padding: 0; width: 100%; background: #110703; }
        *, *::before, *::after { box-sizing: border-box; }
      `}</style>

      <div style={{ textAlign:"center", width:"100%", maxWidth:420, padding:"0 24px" }}>

        {/* Logo — wordmark only */}
        <div style={{ marginBottom: step === 0 ? 40 : 24 }}>
          <div style={{ fontSize:42, fontWeight:800, fontFamily:"'Syne',sans-serif", letterSpacing:"-0.03em", lineHeight:1 }}>
            <span style={{ color:"#C17F3A" }}>Quant</span><span style={{ color:text }}>OS</span>
          </div>
          <div style={{ fontSize:10, color:sub, fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.14em", marginTop:6 }}>
            CAREER OPERATING SYSTEM · {APP_VERSION}
          </div>
        </div>

        {/* Card */}
        <div style={{ background:card, backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
          border:`1px solid ${bdr}`, borderRadius:24, padding:"36px 32px",
          boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.40)" : "0 8px 40px rgba(0,0,0,0.08)" }}>

          {step === 0 ? (
            /* ── Intro step ── */
            <>
              <div style={{ fontSize:22, marginBottom:12 }}>👋</div>
              <h2 style={{ fontSize:18, fontWeight:700, color:text, marginBottom:8, letterSpacing:"-0.01em" }}>
                Free. Open source. Yours.
              </h2>
              <p style={{ fontSize:13, color:sub, lineHeight:1.7, marginBottom:28 }}>
                Everything runs on your device — no accounts, no servers, no data leaves your browser.
                Your progress is always private and always yours.
              </p>

              {/* Feature pills */}
              {[
                ["📚","Courses & Skill Tree"],
                ["🏆","Competition Tracker"],
                ["🎯","Interview Practice"],
                ["🗺","Career Roadmap"],
              ].map(([icon, label]) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0",
                  borderBottom:`1px solid ${bdr}`, textAlign:"left" }}>
                  <span style={{ fontSize:14 }}>{icon}</span>
                  <span style={{ fontSize:12, color:sub }}>{label}</span>
                </div>
              ))}

              <button onClick={() => setStep(1)}
                style={{ marginTop:24, width:"100%", padding:"12px", borderRadius:12, border:"none",
                  background:"#C17F3A", color:"#000", fontSize:14, fontWeight:700,
                  cursor:"pointer", fontFamily:"'Syne',sans-serif", letterSpacing:"0.01em" }}>
                Get Started →
              </button>
            </>
          ) : (
            /* ── Profile setup step ── */
            <>
              <h2 style={{ fontSize:17, fontWeight:700, color:text, marginBottom:4 }}>Quick setup</h2>
              <p style={{ fontSize:12, color:sub, marginBottom:24 }}>Takes 10 seconds. You can change this later.</p>

              {/* Avatar picker */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:10, color:sub, textTransform:"uppercase", letterSpacing:"0.08em",
                  fontFamily:"'JetBrains Mono',monospace", marginBottom:10, textAlign:"left" }}>Pick an avatar</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center" }}>
                  {AVATARS.map(a => (
                    <button key={a} onClick={() => setAvatar(a)}
                      style={{ width:42, height:42, borderRadius:10, border:`2px solid ${a===avatar?"#C17F3A":bdr}`,
                        background: a===avatar ? "rgba(193,127,58,0.12)" : "transparent",
                        fontSize:20, cursor:"pointer", transition:"all 0.15s" }}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Name input */}
              <div style={{ marginBottom:24, textAlign:"left" }}>
                <div style={{ fontSize:10, color:sub, textTransform:"uppercase", letterSpacing:"0.08em",
                  fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>Your name (optional)</div>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleStart()}
                  placeholder="e.g. Arjun, Sarah, Anonymous..."
                  maxLength={32}
                  style={{ width:"100%", padding:"10px 14px", borderRadius:10,
                    border:`1px solid ${bdr}`,
                    background: "rgba(255,255,255,0.05)",
                    color:text, fontSize:13, outline:"none", boxSizing:"border-box",
                    fontFamily:"'DM Sans',sans-serif" }}
                />
              </div>

              {/* Preview */}
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px",
                borderRadius:10, background: isDark ? "rgba(193,127,58,0.06)" : "rgba(193,127,58,0.05)",
                border:"1px solid rgba(193,127,58,0.15)", marginBottom:20 }}>
                <span style={{ fontSize:24 }}>{avatar}</span>
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontSize:13, fontWeight:600, color:text }}>{name.trim() || "Quant Student"}</div>
                  <div style={{ fontSize:10, color:sub, fontFamily:"'JetBrains Mono',monospace" }}>All data saved locally on this device</div>
                </div>
              </div>

              <button onClick={handleStart}
                style={{ width:"100%", padding:"12px", borderRadius:12, border:"none",
                  background:"#C17F3A", color:"#000", fontSize:14, fontWeight:700,
                  cursor:"pointer", fontFamily:"'Syne',sans-serif" }}>
                Enter QuantOS →
              </button>

              <button onClick={() => setStep(0)}
                style={{ marginTop:10, background:"none", border:"none", color:sub,
                  fontSize:12, cursor:"pointer", padding:4 }}>← Back</button>
            </>
          )}
        </div>

        <p style={{ marginTop:16, fontSize:11, color:sub, lineHeight:1.6 }}>
          Open source · No accounts · No tracking · Your data stays on your device
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
//  RESPONSIVE BREAKPOINT HOOK
// ─────────────────────────────────────────────
const useBreakpoint = () => {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200)
  useEffect(() => {
    const handler = () => setW(window.innerWidth)
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [])
  // mobile < 640 | tablet 640–1023 | desktop ≥ 1024
  return { w, isMobile: w < 640, isTablet: w >= 640 && w < 1024, isDesktop: w >= 1024 }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: src/App.jsx  (main shell — theme, layout, routing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI SETTINGS MODAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const AISettingsModal = ({ onClose, aiSettings, setAiSettings, T, isDark }) => {
  const [localProvider, setLocalProvider] = useState(aiSettings.provider || "groq")
  const [localKey, setLocalKey]           = useState(aiSettings.key || "")
  const [showKey, setShowKey]             = useState(false)
  const [testStatus, setTestStatus]       = useState(null) // null | "testing" | "ok" | "fail"

  const txt  = T?.text    || "#f1f5f9"
  const sub  = T?.textSub || "#64748b"
  const bg   = T?.bg      || "#050510"
  const card = T?.cardBg  || "rgba(255,255,255,0.04)"
  const bdr  = T?.cardBorder || "rgba(255,255,255,0.08)"
  const muted= T?.textMuted || "#475569"

  const p = AI_PROVIDERS[localProvider]

  const testConnection = async () => {
    setTestStatus("testing")
    try {
      const result = await callAI({
        system: "You are a test assistant.",
        prompt: "Reply with exactly: OK",
        maxTokens: 10,
        aiSettings: { provider: localProvider, key: localKey }
      })
      setTestStatus(result.includes("OK") || result.length > 0 ? "ok" : "fail")
    } catch { setTestStatus("fail") }
  }

  const save = () => {
    setAiSettings({ provider: localProvider, key: localKey })
    onClose()
  }

  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center",
      background:"rgba(0,0,0,0.6)", backdropFilter:"blur(8px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width:"min(480px, 92vw)", borderRadius:20, background: "#1a0b05",
          border:`1px solid ${bdr}`, padding:"28px 28px 24px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
          <div>
            <div style={{ fontSize:17, fontWeight:800, color:txt, fontFamily:"'Syne',sans-serif" }}>⚙ AI Settings</div>
            <div style={{ fontSize:11, color:muted, marginTop:2 }}>Your key stays on your device. We never see it.</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:muted, fontSize:20, cursor:"pointer", padding:4 }}>✕</button>
        </div>

        {/* Provider selector */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10, color:muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10,
            fontFamily:"'JetBrains Mono',monospace" }}>Choose provider</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {Object.entries(AI_PROVIDERS).map(([id, prov]) => (
              <button key={id} onClick={() => { setLocalProvider(id); setTestStatus(null) }}
                style={{ padding:"10px 12px", borderRadius:10, cursor:"pointer", textAlign:"left",
                  border:`1px solid ${localProvider === id ? prov.badgeColor+"60" : bdr}`,
                  background: localProvider === id ? `${prov.badgeColor}10` : card,
                  transition:"all 0.15s" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:3 }}>
                  <span style={{ fontSize:12, fontWeight:700, color: localProvider === id ? prov.badgeColor : txt }}>{prov.label}</span>
                  <span style={{ fontSize:8, color: prov.badgeColor, background:`${prov.badgeColor}18`,
                    border:`1px solid ${prov.badgeColor}30`, padding:"1px 5px", borderRadius:4,
                    fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>{prov.badge}</span>
                </div>
                <div style={{ fontSize:9, color:muted, lineHeight:1.4 }}>{prov.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* API Key input */}
        <div style={{ marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <div style={{ fontSize:10, color:muted, textTransform:"uppercase", letterSpacing:"0.08em",
              fontFamily:"'JetBrains Mono',monospace" }}>API Key</div>
            <a href={p.keyUrl} target="_blank" rel="noreferrer"
              style={{ fontSize:10, color:"#C17F3A", textDecoration:"none", fontFamily:"'JetBrains Mono',monospace" }}>
              Get free key →
            </a>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <input
              type={showKey ? "text" : "password"}
              value={localKey}
              onChange={e => { setLocalKey(e.target.value); setTestStatus(null) }}
              placeholder={p.keyPlaceholder}
              style={{ flex:1, background: "rgba(255,255,255,0.055)",
                border:`1px solid ${bdr}`, borderRadius:8, padding:"9px 12px",
                color:txt, fontSize:12, outline:"none", fontFamily:"'JetBrains Mono',monospace" }}
            />
            <button onClick={() => setShowKey(s => !s)}
              style={{ padding:"9px 12px", borderRadius:8, border:`1px solid ${bdr}`,
                background:card, color:muted, fontSize:11, cursor:"pointer" }}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {/* Test + status */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
          <button onClick={testConnection} disabled={!localKey.trim() || testStatus === "testing"}
            style={{ padding:"7px 16px", borderRadius:8, border:"1px solid rgba(99,102,241,0.4)",
              background:"rgba(99,102,241,0.08)", color:"#818cf8", fontSize:11, cursor:"pointer",
              fontFamily:"'JetBrains Mono',monospace", opacity: !localKey.trim() ? 0.5 : 1 }}>
            {testStatus === "testing" ? "Testing…" : "Test connection"}
          </button>
          {testStatus === "ok"   && <span style={{ fontSize:11, color:"#10b981" }}>✓ Connected</span>}
          {testStatus === "fail" && <span style={{ fontSize:11, color:"#ef4444" }}>✗ Failed — check key</span>}
        </div>

        {/* Save */}
        <button onClick={save}
          style={{ width:"100%", padding:"11px", borderRadius:10, border:"none",
            background: localKey.trim() ? "#C17F3A" : "rgba(193,127,58,0.2)",
            color: localKey.trim() ? "#000" : "#C17F3A",
            fontSize:13, fontWeight:700, cursor: localKey.trim() ? "pointer" : "default",
            fontFamily:"'Syne',sans-serif", transition:"all 0.2s" }}>
          {localKey.trim() ? "Save & Enable AI Features" : "Enter a key to enable AI"}
        </button>

        {/* No key message */}
        {!aiSettings.key && (
          <div style={{ marginTop:12, padding:"10px 14px", borderRadius:8,
            background:"rgba(193,127,58,0.06)", border:"1px solid rgba(193,127,58,0.15)" }}>
            <div style={{ fontSize:11, color:"#C17F3A", lineHeight:1.6 }}>
              💡 AI features (interview feedback, career advice, competition search) need a key.
              Everything else works without one — progress tracking, courses, competitions list, skill tree.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENT: CareerPrep — mobile-only tab merging Practice + Networking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CareerPrep = ({ T, isMobile, aiSettings, githubData = {}, markStudyToday = ()=>{} }) => {
  const [tab, setTab] = useState("practice")
  const sub = T?.textSub  || "#8B6250"
  const bdr = T?.cardBorder|| "rgba(180,90,40,0.18)"
  const TABS = [
    { id:"practice",     label:"◉ Practice"     },
    { id:"networking",   label:"◎ Networking"   },
    { id:"internships",  label:"💼 Internships"  },
    { id:"jobs",         label:"🏢 Jobs"          },
  ]
  return (
    <div>
      <div style={{ display:"flex", gap:4, marginBottom:20, borderBottom:`1px solid ${bdr}`, paddingBottom:0, overflowX:"auto", scrollbarWidth:"none" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{ padding:"8px 16px", border:"none", borderRadius:"10px 10px 0 0", cursor:"pointer", flexShrink:0,
              background: tab===t.id ? T?.accentDim||"rgba(193,127,58,0.15)" : "transparent",
              color: tab===t.id ? T?.accent||"#C17F3A" : sub,
              fontSize:11, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
              borderBottom: tab===t.id ? `2px solid ${T?.accent||"#C17F3A"}` : "2px solid transparent",
              transition:"all 0.18s" }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "practice"    && <PracticeHub      T={T} isMobile={isMobile} aiSettings={aiSettings} />}
      {tab === "networking"  && <NetworkingTracker T={T} aiSettings={aiSettings} />}
      {tab === "internships" && <InternshipsTab    T={T} githubData={githubData} />}
      {tab === "jobs"        && <JobsTab           T={T} githubData={githubData} />}
    </div>
  )
}

export default function QuantOS() {
  const [active, setActive]                     = useState("dashboard")
  const { githubData, loading: dataLoading, isLive, loadedKeys } = useGithubData()
  const [courseProgress, setCourseProgress]     = useStorage("course_progress_v2", {})
  const [bookmarks, setBookmarks]               = useStorage("comp_bookmarks_v2", [])
  const [user, setUser]                         = useStorage("auth_user_v2", null)
  // ── Tantra theme: fixed warm-dark palette — no toggle ───────────────────────
  const isDark = true   // always dark; toggle removed
  const [onboardingDone, setOnboardingDone]     = useStorage("onboarding_done_v1", false)
  const [showOnboarding, setShowOnboarding]     = useState(false)
  const { isMobile, isTablet, isDesktop }       = useBreakpoint()

  // ── Tantra background: deep reddish-brown, meditatively grounding ───────────
  const bgMesh = `#110703`

  // ── Glass theme tokens — tantra palette ─────────────────────────────────────
  const T = {
    bg:           bgMesh,
    bgSolid:      "#130804",
    // sidebar glass
    sidebarBg:    "rgba(16, 5, 2, 0.80)",
    sidebarBlur:  "blur(24px) saturate(140%)",
    // borders
    border:       "rgba(180, 90, 40, 0.18)",
    borderHi:     "rgba(240, 190, 110, 0.22)",
    borderGlow:   "rgba(193, 127, 58, 0.32)",
    // text hierarchy — warm off-white body, tacao headings, opium secondary
    textHeading:  "#C8956A",          // tacao — headings & labels only
    text:         "#E8D5C0",          // warm off-white — instantly readable body text
    textSub:      "#9A7A62",          // muted warm — secondary info (lifted slightly)
    textMuted:    "#5a3828",          // dark earth — hints, disabled
    // accent — deep saffron (replaces harsh amber)
    accent:       "#C17F3A",
    accentHi:     "#D4923F",          // hover / active state
    accentDim:    "rgba(193,127,58,0.15)",
    accentBorder: "rgba(193,127,58,0.30)",
    // ── GLASS CARDS — two hierarchy levels ────────────────────────────────────
    cardBg:       "rgba(255,255,255,0.030)",   // default surface
    cardBgHi:     "rgba(255,255,255,0.055)",   // elevated / primary card
    cardBorder:   "rgba(180, 90, 40, 0.18)",
    // ── INNER ROW ITEMS ───────────────────────────────────────────────────────
    rowBg:        "rgba(255,255,255,0.020)",
    rowBorder:    "rgba(180, 90, 40, 0.10)",
    // ── PROGRESS TRACK ────────────────────────────────────────────────────────
    trackBg:      "rgba(255,255,255,0.07)",
    // ── INPUTS / TEXTAREAS ───────────────────────────────────────────────────
    inputBg:      "rgba(255,255,255,0.050)",
    inputBorder:  "rgba(180, 90, 40, 0.22)",
    // ── FUTURE / DISABLED ─────────────────────────────────────────────────────
    textDisabled: "rgba(255,255,255,0.14)",
    // nav
    activeNav:    "rgba(193,127,58,0.16)",
    activeNavC:   "#C17F3A",
    // misc
    scrollThumb:  "rgba(180, 90, 40, 0.28)",
    selectBg:     "#1a0b05",
    bottomNav:    "rgba(14, 5, 2, 0.88)",
    // ── SKILL TREE PANEL ──────────────────────────────────────────────────────
    panelBg:      "rgba(255,255,255,0.028)",
    panelText:    "#C8956A",
    panelMuted:   "#7a5040",
  }

  // ── All hooks ABOVE the early return (Rules of Hooks) ──────────────────────
  const [reviewScheduleShell]  = useStorage("review_schedule_v1",      {})
  const [netContactsShell]     = useStorage("networking_contacts_v1",   [])
  const [interviewHistoryShell]= useStorage("interview_history",         [])
  const [showShortcuts, setShowShortcuts] = useState(false)
  // ── Badge "seen" state — stores last-visited ISO date per tab ───────────────
  const [badgeSeen, setBadgeSeen] = useStorage("badge_seen_v1", {})
  // ── AI provider settings ────────────────────────────────────────────────────
  const [aiSettings, setAiSettings] = useStorage("ai_settings_v1", { provider: "groq", key: "" })
  const [showAISettings, setShowAISettings] = useState(false)
  // ── Extra context for AI advisor ────────────────────────────────────────────
  const [studyLogShell, setStudyLogShell] = useStorage("study_log_v1", {})
  const markStudyToday = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    setStudyLogShell(prev => prev[today] ? prev : { ...prev, [today]: 1 })
  }, [])
  const [lectureProgressShell] = useStorage("lecture_progress_v2",      {})
  const [trackedAppsShell]     = useStorage("tracked_applications_v1",  {})
  const [jobAppsShell]         = useStorage("job_applications_v1",      {})

  useEffect(() => {
    setCourseProgress(prev => {
      const init = { ...prev }; let changed = false
      COURSES.forEach(c => { if (!(c.id in init)) { init[c.id] = 0; changed = true } })
      return changed ? init : prev
    })
  }, [])

  useEffect(()=>{
    let lastG = false
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return
      if (e.key === "?" && !e.shiftKey) { setShowShortcuts(s=>!s); return }
      if (e.key === "Escape") { setShowShortcuts(false); return }
      if (lastG) {
        const map = { d:"dashboard", l:"learning", c:"competitions", i:"interview", f:"interview", n:"networking", r:"resources", m:"roadmap" }
        if (map[e.key]) { setActive(map[e.key]); lastG=false; return }
        lastG = false; return
      }
      if (e.key === "g") { lastG=true; setTimeout(()=>{lastG=false},1500) }
    }
    window.addEventListener("keydown", handler)
    return ()=>window.removeEventListener("keydown", handler)
  }, [])

  const navigate = (id) => {
    setActive(id)
    // Mark tab as visited so badge clears
    setBadgeSeen(prev => ({ ...prev, [id]: new Date().toISOString() }))
  }

  if (!user) return <WelcomeScreen onLogin={u => { setUser(u); if(!onboardingDone) setShowOnboarding(true) }} isDark={isDark} />
  if (dataLoading) return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      background:"#110703", fontFamily:"'JetBrains Mono',monospace", gap:16 }}>
      <div style={{ fontSize:28, fontWeight:800, fontFamily:"'Syne',sans-serif" }}>
        <span style={{ color:"#C17F3A" }}>Quant</span><span style={{ color:"#E8D5C0" }}>OS</span>
      </div>
      <div style={{ fontSize:12, color:"#9A7A62", letterSpacing:"0.1em" }}>LOADING DATA...</div>
      <div style={{ width:120, height:2, background:"rgba(193,127,58,0.15)", borderRadius:99, overflow:"hidden" }}>
        <div style={{ height:"100%", background:"#C17F3A", borderRadius:99, animation:"qos-load 1.2s ease-in-out infinite" }}/>
      </div>
      <style>{`@keyframes qos-load { 0%{width:0%} 50%{width:100%} 100%{width:0%;margin-left:100%} }`}</style>
    </div>
  )

  // ── Sidebar alert badges (plain computation — no hooks) ───────────────────
  const today = new Date().toISOString().slice(0,10)

  // Helper: has the user visited this tab since the last time urgency changed?
  const seenSince = (tabId, sinceDate) => {
    const s = badgeSeen[tabId]
    return s && s >= sinceDate
  }

  // Competitions: only badge if deadline ≤ 3 days AND user hasn't visited since it became urgent
  const urgentComps = COMPETITIONS.filter(c => {
    const d = daysUntil(c.deadline); return c.status === "open" && d !== null && d >= 0 && d <= 3
  })
  const urgentCompetitions = seenSince("competitions", today) ? 0 : urgentComps.length

  // Learning: course reviews overdue
  const overdueReviews = Object.values(reviewScheduleShell).filter(d => d <= today)
  const reviewsDueBadge = seenSince("learning", today) ? 0 : overdueReviews.length

  // Networking: follow-ups overdue
  const overdueFollowups = netContactsShell.filter(c => {
    if (!c.date || c.status === "Closed") return false
    return Math.floor((new Date() - new Date(c.date)) / 86400000) >= 21 && ["Connected","Messaged","Replied"].includes(c.status)
  })
  const followUpsBadge = seenSince("networking", today) ? 0 : overdueFollowups.length

  // Interview: only badge if there are weak categories (avg < 6) AND user hasn't practiced today
  const interviewBadge = (() => {
    if (seenSince("interview", today)) return 0
    if (!interviewHistoryShell.length) return 0   // no history yet — no nag
    const weakCats = Object.keys(INTERVIEW_QS).filter(cat => {
      const sessions = interviewHistoryShell.filter(h => h.category === cat)
      if (!sessions.length) return false
      return sessions.reduce((a, b) => a + b.score, 0) / sessions.length < 6
    })
    return weakCats.length
  })()

  const NAV_BADGES = {
    competitions: urgentCompetitions,
    learning:     reviewsDueBadge,
    networking:   followUpsBadge,
    interview:    interviewBadge,
  }

  const renderModule = () => {
    // ── Rich context for AI advisor — built fresh every render ─────────────────
    const todayStr = new Date().toISOString().slice(0, 10)
    const totalCourses = COURSES.length
    const completedCourses = Object.values(courseProgress).filter(v => v === 1).length
    const inProgressCourses = Object.values(courseProgress).filter(v => v === 0.5).length

    // Study streak
    const studyDays = Object.keys(studyLogShell).sort().reverse()
    let streak = 0
    for (let i = 0; i < studyDays.length; i++) {
      const expected = new Date(Date.now() - i * 86400000).toISOString().slice(0,10)
      if (studyDays[i] === expected) streak++; else break
    }
    const totalStudyDays = studyDays.length
    const lastStudyDate  = studyDays[0] || null
    const daysSinceStudy = lastStudyDate
      ? Math.floor((Date.now() - new Date(lastStudyDate)) / 86400000) : null

    // Lecture progress
    const totalLectures    = Object.keys(lectureProgressShell).length
    const doneLectures     = Object.values(lectureProgressShell).filter(v => v === 1).length

    // Interview stats
    const allScores  = interviewHistoryShell.map(h => h.score).filter(Boolean)
    const avgScore   = allScores.length ? (allScores.reduce((a,b)=>a+b,0)/allScores.length).toFixed(1) : null
    const totalSessions = interviewHistoryShell.length
    const recentSessions = interviewHistoryShell.slice(0, 5)
    const categoryBreakdown = {}
    interviewHistoryShell.forEach(h => {
      if (!categoryBreakdown[h.category]) categoryBreakdown[h.category] = []
      categoryBreakdown[h.category].push(h.score)
    })
    const weakCategories = Object.entries(categoryBreakdown)
      .map(([cat, scores]) => ({ cat, avg: (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) }))
      .filter(c => parseFloat(c.avg) < 6)
      .map(c => `${c.cat} (avg ${c.avg}/10)`)
    const strongCategories = Object.entries(categoryBreakdown)
      .map(([cat, scores]) => ({ cat, avg: (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) }))
      .filter(c => parseFloat(c.avg) >= 7)
      .map(c => `${c.cat} (avg ${c.avg}/10)`)

    // Review schedule
    const overdueReviews = Object.values(reviewScheduleShell).filter(d => d <= todayStr).length
    const upcomingReviews = Object.values(reviewScheduleShell).filter(d => d > todayStr).length

    // Networking
    const totalContacts = netContactsShell.length
    const contactsByStatus = {}
    netContactsShell.forEach(c => { contactsByStatus[c.status] = (contactsByStatus[c.status]||0)+1 })
    const overdueFollowups = netContactsShell.filter(c => {
      if (!c.date || c.status === "Closed") return false
      return Math.floor((Date.now()-new Date(c.date))/86400000) >= 21
    }).length

    // Applications
    const compApps  = Object.values(trackedAppsShell)
    const jobAppArr = Object.values(jobAppsShell)
    const appSummary = {
      competitions: {
        applied:      compApps.filter(s=>s==="Applied").length,
        interviewing: compApps.filter(s=>s==="Interviewing").length,
        offer:        compApps.filter(s=>s==="Offer").length,
      },
      jobs: {
        saved:        jobAppArr.filter(s=>s==="saved").length,
        applied:      jobAppArr.filter(s=>s==="applied").length,
        interviewing: jobAppArr.filter(s=>s==="interviewing").length,
        offer:        jobAppArr.filter(s=>s==="offer").length,
      }
    }

    const userContext = {
      // Identity
      name: user?.name || "Student",
      // Courses
      totalCourses, completedCourses, inProgressCourses,
      courseCompletionPct: Math.round(completedCourses / totalCourses * 100),
      // Study habit
      streak, totalStudyDays, daysSinceStudy,
      lastStudyDate,
      // Lectures
      totalLectures, doneLectures,
      // Interview
      avgScore, totalSessions, weakCategories, strongCategories,
      recentSessions,
      // Reviews
      overdueReviews, upcomingReviews,
      // Networking
      totalContacts, contactsByStatus, overdueFollowups,
      // Applications
      appSummary,
    }

    switch (active) {
      case "dashboard":    return <Dashboard courseProgress={courseProgress} bookmarks={bookmarks} T={T} onStartTour={()=>setShowOnboarding(true)} navigate={setActive} isMobile={isMobile} />
      case "learning":     return <LearningPath courseProgress={courseProgress} setCourseProgress={setCourseProgress} T={T} user={user} aiSettings={aiSettings} githubData={githubData} markStudyToday={markStudyToday} />
      case "competitions": return <CompetitionTracker bookmarks={bookmarks} setBookmarks={setBookmarks} T={T} aiSettings={aiSettings} githubData={githubData} />
      case "interview":    return <PracticeHub T={T} isMobile={isMobile} aiSettings={aiSettings} markStudyToday={markStudyToday} />
      case "resources":    return <ResourceHub T={T} />
      case "networking":   return <NetworkingTracker T={T} aiSettings={aiSettings} markStudyToday={markStudyToday} />
      case "career":       return <CareerPrep T={T} isMobile={isMobile} aiSettings={aiSettings} githubData={githubData} markStudyToday={markStudyToday} />
      case "roadmap":      return <CareerRoadmap T={T} courseProgress={courseProgress} navigate={setActive} isMobile={isMobile} isTablet={isTablet} aiSettings={aiSettings} userContext={userContext} />
      default: return null
    }
  }

  // ── Icon-only sidebar rail ──────────────────────────────────────────────────
  const SidebarRail = () => (
    <div style={{
      width: 68, flexShrink: 0,
      background: T.sidebarBg,
      backdropFilter: T.sidebarBlur, WebkitBackdropFilter: T.sidebarBlur,
      borderRight: "none",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "20px 0",
      position: "sticky", top: 0, height: "100vh",
      boxShadow: isDark
        ? "8px 0 32px rgba(0,0,0,0.35), 1px 0 0 rgba(255,255,255,0.03)"
        : "8px 0 40px rgba(0,0,0,0.06), 1px 0 0 rgba(255,255,255,0.9)",
      zIndex: 10,
    }}>
      {/* Logo badge */}
      <div style={{
        width: 38, height: 38, borderRadius: 11, marginBottom: 24,
        background: isDark
          ? "rgba(193,127,58,0.12)"
          : "rgba(255,255,255,0.80)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        border: `1px solid ${T.borderGlow}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 16px rgba(193,127,58,0.18)",
      }}>
        <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Syne',sans-serif", color: "#C17F3A" }}>Q</span>
      </div>
   
        <div
        title={isLive ? `Live data: ${loadedKeys.join(", ")}` : "Using local fallback data"}
        style={{
          fontSize:9, fontFamily:"'JetBrains Mono',monospace",
          color:      isLive ? "#10b981" : "#C17F3A",
          background: isLive ? "rgba(16,185,129,0.12)" : "rgba(193,127,58,0.12)",
          border:    `1px solid ${isLive ? "rgba(16,185,129,0.25)" : "rgba(193,127,58,0.25)"}`,
          borderRadius:4, padding:"2px 5px", marginBottom:8,
          letterSpacing:"0.04em", cursor:"default", userSelect:"none",
        }}>
        {isLive ? "GH ✓" : "LOCAL"}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, width: "100%", padding: "0 8px" }}>
        {NAV_ITEMS.filter(item => !item.mobileOnly).map(item => {
          const isActive = active === item.id
          return (
            <button key={item.id} onClick={() => navigate(item.id)}
              data-tip={item.label} className="qos-tip"
              style={{
                width: "100%", height: 44,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 10, border: "none", cursor: "pointer",
                transition: "all 0.18s",
                background: isActive
                  ? isDark ? "rgba(193,127,58,0.14)" : "rgba(255,255,255,0.70)"
                  : "transparent",
                backdropFilter: isActive ? "blur(8px)" : "none",
                WebkitBackdropFilter: isActive ? "blur(8px)" : "none",
                color: isActive ? (isDark ? "#C17F3A" : "#c97a04") : T.textSub,
                boxShadow: isActive
                  ? isDark
                    ? "0 0 0 1px rgba(193,127,58,0.28) inset, 0 2px 8px rgba(0,0,0,0.2)"
                    : "0 0 0 1px rgba(193,127,58,0.25) inset, 0 2px 12px rgba(0,0,0,0.06)"
                  : "none",
                position: "relative",
              }}>
              <NavIcon id={item.id} size={20} color={isActive ? "#C17F3A" : T.textSub} />
              {/* Alert badge */}
              {NAV_BADGES[item.id] > 0 && (
                <div style={{
                  position:"absolute", top:6, right:6,
                  width:8, height:8, borderRadius:"50%",
                  background:"#ef4444",
                  boxShadow:"none",
                  border:`1px solid ${isDark?"rgba(7,7,15,0.9)":"rgba(255,255,255,0.9)"}`,
                }}/>
              )}
              {isActive && (
                <div style={{
                  position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
                  width: 3, height: 20, borderRadius: "3px 0 0 3px",
                  background: "linear-gradient(180deg,#C17F3A,#A86B2E)",
                  boxShadow: "none",
                }} />
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:"12px 8px 0", borderTop:`1px solid ${T.border}`, width:"100%" }}>
        <button onClick={() => setShowShortcuts(s=>!s)}
          data-tip="Keyboard shortcuts (?)" className="qos-tip"
          style={{
            width:"100%", height:32, borderRadius:8,
            border:`1px solid ${showShortcuts?"rgba(193,127,58,0.35)":T.border}`,
            background:showShortcuts?"rgba(193,127,58,0.10)":"transparent",
            color:showShortcuts?"#C17F3A":T.textMuted, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:12,
            fontFamily:"'JetBrains Mono',monospace", transition:"all 0.18s",
          }}>?</button>
        {/* AI Settings button — glows if no key set */}
        <button onClick={() => setShowAISettings(true)}
          data-tip="AI Settings" className="qos-tip"
          style={{
            width:"100%", height:32, borderRadius:8, position:"relative",
            border:`1px solid ${aiSettings.key ? T.border : "rgba(193,127,58,0.4)"}`,
            background: aiSettings.key ? "transparent" : "rgba(193,127,58,0.08)",
            color: aiSettings.key ? T.textMuted : "#C17F3A",
            cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:13, transition:"all 0.18s",
          }}>
          ⚙
          {!aiSettings.key && (
            <div style={{ position:"absolute", top:4, right:4, width:6, height:6, borderRadius:"50%",
              background:"#C17F3A" }}/>
          )}
        </button>
        {user.picture
          ? <img src={user.picture} onClick={() => setUser(null)}
              data-tip="Sign out" className="qos-tip"
              style={{ width:32, height:32, borderRadius:"50%", cursor:"pointer",
                border:`2px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.85)"}`,
                boxShadow:"0 2px 8px rgba(0,0,0,0.12)", objectFit:"cover" }} />
          : <div onClick={() => setUser(null)}
              data-tip={`${user.name||"Guest"} · Sign out`} className="qos-tip"
              style={{
                width:32, height:32, borderRadius:"50%", cursor:"pointer",
                background: isDark ? "rgba(193,127,58,0.18)" : "rgba(255,255,255,0.75)",
                backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)",
                border:`1px solid ${T.borderGlow}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:13, fontWeight:700, color:"#C17F3A",
                boxShadow:"0 2px 8px rgba(193,127,58,0.15)",
              }}>
              {user.avatar || user.name?.[0] || "G"}
            </div>
        }
      </div>
    </div>
  )

  const contentPad = isMobile ? "16px 16px 70px" : isDesktop ? "32px 40px" : "24px 28px"

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@300;400;500;600&display=swap');
        html, body, #root { margin: 0; padding: 0; width: 100%; min-height: 100%; background: #110703; }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.scrollThumb}; border-radius: 99px; }
        textarea::placeholder, input::placeholder { color: ${T.textMuted}; }
        select option { background: ${T.selectBg}; color: ${T.text}; }
        iframe { border: none; }

        /* ── Global glass surface propagation ──
           Modules set background: T.cardBg inline. We add backdrop-filter + the
           inner top-edge highlight via a global rule so every card glows correctly
           without touching any module code.                                       */
        .qos-root * {
          /* pass-through — no global override needed; blur handled per-element */
        }
        /* Glass card surfaces */
        [style*="rgba(255,255,255,0.035)"] { backdrop-filter:blur(14px) saturate(150%); -webkit-backdrop-filter:blur(14px) saturate(150%); }
        /* Inputs */
        [style*="rgba(255,255,255,0.055)"] { backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); }

        /* ── CSS tooltip (icon rail) ── */
        .qos-tip { position: relative; }
        .qos-tip::after {
          content: attr(data-tip);
          position: absolute; left: calc(100% + 14px); top: 50%;
          transform: translateY(-50%) scale(0.94);
          background: rgba(26,11,5,0.95);
          backdrop-filter: blur(16px) saturate(180%);
          -webkit-backdrop-filter: blur(16px) saturate(180%);
          color: ${T.text}; padding: 5px 12px; border-radius: 9px;
          font-size: 11px; font-family: 'DM Sans', sans-serif; font-weight: 500;
          white-space: nowrap; pointer-events: none; opacity: 0;
          transition: opacity 0.16s, transform 0.16s;
          border: 1px solid rgba(193,127,58,0.22);
          box-shadow: 0 4px 20px rgba(0,0,0,0.12);
          z-index: 999;
        }
        .qos-tip:hover::after { opacity: 1; transform: translateY(-50%) scale(1); }


        /* ── Glass shadow system ────────────────────────────────────────────────────
           Panels, tiles, and cards automatically pick up depth via CSS attribute
           selectors targeting T.cardBg values. No module code changes needed.     */

        /* Tantra card shadow */
        [style*="rgba(255,255,255,0.035)"] {
          box-shadow:
            0 1px 0 rgba(255,255,255,0.04) inset,
            0 4px 16px rgba(0,0,0,0.35),
            0 16px 48px rgba(0,0,0,0.28) !important;
        }
        /* Sidebar shadow */
        [style*="rgba(16, 5, 2, 0.80)"] {
          box-shadow:
            2px 0 0 rgba(255,255,255,0.03) inset,
            4px 0 32px rgba(0,0,0,0.25) !important;
        }
        /* Orange accent hover glow on interactive tiles */
        .qos-tile-hover:hover {
          box-shadow:
            0 0 0 1px rgba(193,127,58,0.22),
            0 8px 32px rgba(193,127,58,0.08),
            0 2px 8px rgba(0,0,0,0.10) !important;
          transform: translateY(-1px);
          transition: all 0.2s ease;
        }
        @keyframes qos-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div className="qos-root" style={{
        display:"flex", minHeight:"100vh",
        background: T.bg,
        fontFamily:"'Inter',system-ui,sans-serif", color:T.text,
        transition:"background 0.5s, color 0.3s",
        overflowX:"hidden",
        width:"100%",
      }}>
        {!isMobile && <SidebarRail />}

        {/* Main content */}
        <div style={{ flex:1, overflowY:"auto", overflowX:"clip", maxHeight:isMobile?"100dvh":"100vh", minWidth:0,
          scrollbarWidth:"thin", scrollbarColor:`${T.scrollThumb} transparent` }}>
          <div style={{ padding:contentPad, width:"100%", boxSizing:"border-box" }}>
          <div style={{ maxWidth:1280, margin:"0 auto", width:"100%" }}>

          {/* Mobile top bar */}
          {isMobile && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, paddingBottom:14, borderBottom:`1px solid ${T.border}` }}>
              <div style={{ fontSize:20, fontWeight:800, fontFamily:"'Syne',sans-serif", letterSpacing:"-0.02em" }}>
                <span style={{ color:"#C17F3A" }}>Quant</span>
                <span style={{ color:T.text }}>OS</span>
                <span style={{ fontSize:9, color:T.textMuted, marginLeft:7, fontFamily:"'JetBrains Mono',monospace", verticalAlign:"middle" }}>{APP_VERSION}</span>
              </div>
              <div style={{ fontSize:11, color:T.textSub, fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.06em" }}>
                {NAV_ITEMS.find(n=>n.id===active)?.label || ""}
              </div>
            </div>
          )}

          {renderModule()}
          </div>{/* /max-width wrapper */}
          </div>{/* /padding wrapper */}
        </div>

        {/* Mobile bottom glass tab bar — horizontally scrollable */}
        {isMobile && (
          <div style={{
            position:"fixed", bottom:0, left:0, right:0,
            background: "rgba(14,5,2,0.90)",
            backdropFilter:"blur(28px) saturate(160%)", WebkitBackdropFilter:"blur(28px) saturate(160%)",
            zIndex:50,
            boxShadow: "0 -8px 32px rgba(0,0,0,0.50), 0 -1px 0 rgba(180,90,40,0.12)",
            paddingBottom:"env(safe-area-inset-bottom, 0px)",
          }}>
            {/* Scroll hint fade — right edge */}
            <div style={{
              position:"absolute", right:0, top:0, bottom:0, width:32, zIndex:1, pointerEvents:"none",
              background: "linear-gradient(to right, transparent, rgba(14,5,2,0.92))",
            }}/>
            <div style={{
              display:"flex", alignItems:"stretch",
              overflowX:"auto", overflowY:"hidden",
              scrollSnapType:"x mandatory",
              WebkitOverflowScrolling:"touch",
              scrollbarWidth:"none",
              msOverflowStyle:"none",
              height:54,
              padding:"0 4px",
            }}>
              {/* Hide scrollbar for webkit */}
              <style>{`.qos-nav-scroll::-webkit-scrollbar{display:none}`}</style>
              {NAV_ITEMS.filter(item => !item.desktopOnly).map(item => {
                const isActive = active === item.id
                const badge = NAV_BADGES[item.id]
                return (
                  <button key={item.id} onClick={() => navigate(item.id)}
                    style={{
                      flexShrink: 0,
                      width: 56,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      border:"none", cursor:"pointer",
                      background:"transparent",
                      scrollSnapAlign:"center",
                      position:"relative",
                      transition:"all 0.18s",
                      padding:0,
                      height:"100%",
                    }}>
                    {/* Active pill */}
                    {isActive && (
                      <div style={{
                        position:"absolute", top:"50%", left:"50%",
                        transform:"translate(-50%,-50%)",
                        width:44, height:40, borderRadius:12,
                        background: "rgba(193,127,58,0.15)",
                        backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)",
                        border: "1px solid rgba(193,127,58,0.28)",
                        boxShadow: "none",
                      }}/>
                    )}
                    {/* Badge dot */}
                    {badge > 0 && (
                      <div style={{
                        position:"absolute", top:"14%", right:"16%",
                        width:7, height:7, borderRadius:"50%",
                        background:"#ef4444",
                        boxShadow:"none",
                        border:`1px solid rgba(14,5,2,0.9)`,
                        zIndex:2,
                      }}/>
                    )}
                    <NavIcon id={item.id} size={isActive ? 21 : 19} color={isActive ? "#C17F3A" : T.textSub} />
                  </button>
                )
              })}
              {/* AI Settings */}
              <button onClick={() => setShowAISettings(true)}
                style={{
                  flexShrink:0, width:46, position:"relative",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  border:"none", background:"transparent", cursor:"pointer",
                  height:"100%", padding:0,
                }}>
                <span style={{ fontSize:17, color: aiSettings.key ? T.textSub : "#C17F3A" }}>⚙</span>
                {!aiSettings.key && (
                  <div style={{ position:"absolute", top:"18%", right:"18%", width:6, height:6, borderRadius:"50%",
                    background:"#C17F3A", boxShadow:"none" }}/>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── AI Settings Modal ── */}
      {showAISettings && (
        <AISettingsModal
          onClose={() => setShowAISettings(false)}
          aiSettings={aiSettings}
          setAiSettings={setAiSettings}
          T={T} isDark={isDark}
        />
      )}

      {/* ── Onboarding overlay ── */}
      {showOnboarding && (
        <Onboarding isDark={isDark} onDone={()=>{ setShowOnboarding(false); setOnboardingDone(true) }}/>
      )}

      {/* ── Keyboard shortcuts modal ── */}
      {showShortcuts && (
        <div onClick={()=>setShowShortcuts(false)} style={{
          position:"fixed",inset:0,zIndex:9990,
          background:"rgba(4,4,12,0.70)",
          backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
          display:"flex",alignItems:"center",justifyContent:"center",
          animation:"qos-fade 0.18s ease",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            width:380,borderRadius:20,
            background:"rgba(26,11,5,0.98)",
            border:"1px solid rgba(193,127,58,0.20)",
            boxShadow:"0 32px 80px rgba(0,0,0,0.5)",
            padding:"28px 32px",
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:15,fontWeight:700,color:"#e8c9a0",fontFamily:"'Syne',sans-serif"}}>
                Keyboard Shortcuts
              </div>
              <button onClick={()=>setShowShortcuts(false)}
                style={{background:"none",border:"none",color:"#5a3828",cursor:"pointer",fontSize:18}}>✕</button>
            </div>
            {[
              ["g then d","Dashboard"],
              ["g then l","Learning Path"],
              ["g then c","Competitions"],
              ["g then i / f","Practice (Interview + Flashcards)"],
              ["g then f","Flashcards"],
              ["g then n","Networking"],
              ["g then m","Career Roadmap"],
              ["g then r","Resources"],
              ["?","Toggle this panel"],
              ["Esc","Close overlay"],
            ].map(([key,label])=>(
              <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"8px 0",borderBottom:`1px solid rgba(180,90,40,0.12)`}}>
                <span style={{fontSize:13,color:"#9a7055"}}>{label}</span>
                <span style={{fontSize:11,color:"#C17F3A",fontFamily:"'JetBrains Mono',monospace",
                  background:"rgba(193,127,58,0.10)",border:"1px solid rgba(193,127,58,0.25)",
                  padding:"3px 10px",borderRadius:6}}>
                  {key}
                </span>
              </div>
            ))}
            <div style={{marginTop:16,fontSize:11,color:"#5a3828",textAlign:"center"}}>
              Press anywhere outside or Esc to close
            </div>
          </div>
        </div>
      )}
    </>
  )
}
