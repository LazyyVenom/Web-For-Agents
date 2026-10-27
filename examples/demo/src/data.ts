export interface Book {
  slug: string;
  title: string;
  author: string;
  price: number;
  sku: string;
  blurb: string;
}

export const BOOKS: Book[] = [
  {
    slug: "the-lighthouse-keepers-atlas",
    title: "The Lighthouse Keeper's Atlas",
    author: "Maren Holt",
    price: 18.5,
    sku: "PLB-001",
    blurb: "A illustrated tour of twelve invented lighthouses and the people who tend them.",
  },
  {
    slug: "salt-and-cedar",
    title: "Salt and Cedar",
    author: "Ines Okafor",
    price: 14,
    sku: "PLB-002",
    blurb: "A quiet novel about two sisters restoring a boatyard on a northern coast.",
  },
  {
    slug: "small-maps-of-large-rivers",
    title: "Small Maps of Large Rivers",
    author: "Tobias Reyes",
    price: 22.75,
    sku: "PLB-003",
    blurb: "Essays on following rivers from source to sea, with hand-drawn maps.",
  },
];

export interface Post {
  slug: string;
  title: string;
  date: string;
  summary: string;
  paragraphs: string[];
}

export const POSTS: Post[] = [
  {
    slug: "why-we-shelve-by-mood",
    title: "Why we shelve by mood",
    date: "2026-09-12",
    summary: "How a bookshop with no fiction section found its readers.",
    paragraphs: [
      "When Paper Lantern opened, we threw out the genre signs. A shelf labelled rainy afternoon sells more than one labelled mystery.",
      "Readers browse by how they want to feel, so we follow them.",
    ],
  },
  {
    slug: "a-year-of-small-press-picks",
    title: "A year of small press picks",
    date: "2026-10-03",
    summary: "Twelve months, twelve small press books we could not stop recommending.",
    paragraphs: [
      "Every month a bookseller picks one title from an independent press and writes a card for it.",
      "This year the favourites were short, strange and beautifully printed.",
    ],
  },
];

export const NEW_ARRIVALS = [
  { title: "Lanterns for Beginners", author: "Priya Nandakumar" },
  { title: "The Ferry Timetable", author: "Jonas Aalto" },
  { title: "Moss", author: "Clementine Duarte" },
];

export const FAQ = [
  { question: "Do you ship internationally?", answer: "Yes. We ship to most countries; delivery takes 5 to 12 working days." },
  { question: "Can I return a book?", answer: "Unread books can be returned within 30 days for a full refund." },
  { question: "Do you buy used books?", answer: "We buy used books in good condition on the first Saturday of each month." },
];

export const SITE_URL = __SITE_URL__;
