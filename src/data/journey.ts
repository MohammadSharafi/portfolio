/**
 * The narrative spine of the hero. Each chapter is a place the camera travels
 * to, and every one of them is rendered in the DOM as well as in 3D — the
 * story has to be readable with WebGL disabled, by a screen reader, and by a
 * crawler, not only by someone with a GPU.
 */
export interface Chapter {
  id: string;
  /** Ordinal shown above the caption. */
  index: string;
  place: string;
  period: string;
  title: string;
  body: string;
}

export const journey: readonly Chapter[] = [
  {
    id: 'village',
    index: '01',
    place: 'A village in Iran',
    period: 'Where it starts',
    title: 'No fibre, no bootcamp, no shortcut',
    body: 'A small village a long way from anything that looked like a career in software. What it did have was a sky with nothing in the way of it, and the particular stubbornness that comes from being far enough out that nobody is going to hand you the next step.',
  },
  {
    id: 'exam',
    index: '02',
    place: 'A top-tier state school',
    period: 'The exam years',
    title: 'One number decides the next four years',
    body: "I earned a place at a selective school, then spent the years after it studying for Iran's national university entrance exam — a single ranking, taken once, that decides where you are allowed to go. A desk, a stack of books, and a bulb that stayed on late.",
  },
  {
    id: 'university',
    index: '03',
    place: 'Isfahan University of Technology',
    period: '2018 — 2022',
    title: 'One of the best engineering schools in the country',
    body: 'B.Eng. in Computer Software Engineering. Algorithms, optimisation and distributed systems on paper; mobile architecture in practice — and the first code I wrote that other people actually depended on.',
  },
  {
    id: 'city',
    index: '04',
    place: 'Isfahan · Tehran',
    period: '2018 — 2021',
    title: 'Shipping to people who never asked how it was built',
    body: 'Android work at Byte Group, then Robintel: education apps past 50,000 downloads at 4.5 stars, and banking apps that moved more than $2M. The first time shipping meant somebody else’s money and somebody else’s morning.',
  },
  {
    id: 'crossing',
    index: '05',
    place: 'Iran → Türkiye',
    period: 'The crossing',
    title: 'Starting again, on purpose',
    body: 'I left. New country, new language, new everything — and none of it paused the work: an eight-engineer team at Capgroup, delivering into the U.S. market on somebody else’s clock. Migration is a full-time job stacked on top of a full-time job.',
  },
  {
    id: 'present',
    index: '06',
    place: 'March Health · Remote',
    period: 'Nov 2024 — present',
    title: 'A desk in Türkiye wired into U.S. healthcare',
    body: 'The EHR AI Clinical Assistant — 123+ endpoints, HIPAA compliant, integrated with Cerner/Oracle Health and the Mayo Clinic Platform over SMART on FHIR — and multi-million-patient de-identified datasets behind it. Same curiosity as the village. Considerably larger blast radius.',
  },
] as const;
