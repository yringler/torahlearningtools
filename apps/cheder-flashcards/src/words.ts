// Weekly word lists. To add a week, append a new entry to WEEKS.
// `english` holds every accepted answer; the first is shown as the "correct answer".

export interface Word {
  hebrew: string;
  english: string[];
}

export interface Week {
  id: number;
  label: string;
  words: Word[];
}

export const WEEKS: Week[] = [
  {
    id: 1,
    label: "Week 1",
    words: [
      { hebrew: "כָּל", english: ["all", "every"] },
      { hebrew: "כִּי", english: ["because", "that", "when"] },
      { hebrew: "עַל", english: ["on"] },
      { hebrew: "אַל", english: ["not", "don't"] },
      { hebrew: "לֹא", english: ["not", "don't"] },
      { hebrew: "אֶל", english: ["to"] },
      { hebrew: "עִם", english: ["with"] },
      { hebrew: "אִם", english: ["if"] },
      { hebrew: "גַּם", english: ["also"] },
      { hebrew: "כֵּן", english: ["so", "thus"] },
      { hebrew: "שָׁם", english: ["there"] },
      { hebrew: "עַד", english: ["until"] },
    ],
  },
  {
    id: 2,
    label: "Week 2",
    words: [
      { hebrew: "עַם", english: ["people", "nation"] },
      { hebrew: "שֵׁם", english: ["name"] },
      { hebrew: "יָד", english: ["hand"] },
      { hebrew: "מִן", english: ["from"] },
      { hebrew: "מָה", english: ["what"] },
      { hebrew: "אוֹ", english: ["or"] },
      { hebrew: "מִי", english: ["who"] },
      { hebrew: "נָא", english: ["please"] },
      { hebrew: "הַר", english: ["mountain"] },
      { hebrew: "אַךְ", english: ["but", "only"] },
      { hebrew: "לֵב", english: ["heart"] },
      { hebrew: "אֵשׁ", english: ["fire"] },
    ],
  },
];
