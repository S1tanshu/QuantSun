// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// fetch-playlist.js
// Fetches all videos from a YouTube playlist and outputs a
// schedules.json entry ready to paste into quantos-data.
//
// USAGE:
//   node fetch-playlist.js <courseId> <playlistUrl>
//
// EXAMPLE:
//   node fetch-playlist.js c0 "https://www.youtube.com/playlist?list=PLUl4u3cNGP61Oq3tWYp6V_F-5jb5L2iHb"
//
// SETUP:
//   1. npm install dotenv node-fetch
//   2. Create .env file in same folder with: YT_API_KEY=AIza...
//   3. Make sure .env is in your .gitignore
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "dotenv/config"
import fetch from "node-fetch"
import fs from "fs"
import path from "path"

// ── Args ─────────────────────────────────────────────────────────────
const courseId   = process.argv[2]
const playlistUrl = process.argv[3]

if (!courseId || !playlistUrl) {
  console.error("Usage: node fetch-playlist.js <courseId> <playlistUrl>")
  process.exit(1)
}

const YT_KEY = process.env.YT_API_KEY
if (!YT_KEY) {
  console.error("Missing YT_API_KEY in .env file")
  process.exit(1)
}

// ── Extract playlist ID ───────────────────────────────────────────────
const match = playlistUrl.match(/[?&]list=([^&]+)/)
if (!match) {
  console.error("Could not extract playlist ID from URL")
  process.exit(1)
}
const playlistId = match[1]

// ── Fetch all videos (handles pagination) ────────────────────────────
const fetchAllVideos = async () => {
  let items     = []
  let pageToken = ""

  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems`
      + `?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YT_KEY}`
      + (pageToken ? `&pageToken=${pageToken}` : "")

    const res  = await fetch(url)
    const data = await res.json()

    if (data.error) {
      console.error("YouTube API error:", data.error.message)
      process.exit(1)
    }

    items     = [...items, ...data.items]
    pageToken = data.nextPageToken || ""

    console.log(`Fetched ${items.length} videos so far...`)
  } while (pageToken)

  return items
}

// ── Main ──────────────────────────────────────────────────────────────
const items = await fetchAllVideos()

const lectures = items
  .filter(i => i.snippet.title !== "Private video" && i.snippet.title !== "Deleted video")
  .map((item, idx) => ({
    n:       idx + 1,
    title:   item.snippet.title,
    videoId: item.snippet.resourceId.videoId,
    ps:      false,
  }))

console.log(`\n✓ Found ${lectures.length} lectures\n`)

// ── Build the schedules.json entry ───────────────────────────────────
const entry = {
  [courseId]: {
    playlistUrl,
    notesPage:   "",   // ← fill in manually e.g. MIT OCW page
    psets:       [],   // ← fill in manually if needed
    lectures,
  }
}

// ── Output ────────────────────────────────────────────────────────────
const outFile = `${courseId}_schedule.json`
fs.writeFileSync(outFile, JSON.stringify(entry, null, 2))

console.log(`✓ Written to ${outFile}`)
console.log(`\nNext steps:`)
console.log(`  1. Open ${outFile} and fill in notesPage + any psets`)
console.log(`  2. Merge into quantos-data/schedules.json`)
console.log(`  3. git add . && git commit -m "feat: add schedule for ${courseId}" && git push`)