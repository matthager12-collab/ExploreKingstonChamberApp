// E14 — the EN+ES safety slice (FR-92 / M-14-06 partial). `vk/safety-strings`.
//
// WHY A TYPED DICTIONARY AND NOTHING ELSE: the strings below are the ones a
// visitor acts on — which line to stand in, whether there is a boat home, how
// not to get towed. Getting one of them wrong has a consequence in the real
// world, so every word here is hand-authored and hand-reviewable. There is no
// i18n framework, no locale router, and no runtime machine translation by
// design (the full FR-41 pipeline, including Simplified Chinese, is LTAC-funded
// later work). A plain object means the Spanish can be printed, handed to a
// bilingual reader, and diffed line by line before it ever goes public — which
// is exactly the review gate docs/OPERATIONS.md "Accessibility & language"
// describes, and why /es ships dark until that review happens.
//
// The Spanish is neutral Latin-American, written to the same plain-language bar
// as the English (docs/ACCESSIBILITY.md): grade 6-9, one idea per sentence,
// no unexplained abbreviations, every clock time with am/pm.
//
// Both halves ship: the English renders on /simple, the Spanish on /es, through
// the same <SafetyEssentials/> component. tests/unit/safety-content-parity.test.ts
// asserts the two halves expose identical shapes with no empty strings, so a
// half-finished translation cannot reach a reader.

/** One section of the essentials: a heading, ordered one-idea steps, and at
 *  most one closing caveat. Deliberately flat — the shape is the contract the
 *  parity test checks, and a nested/optional-heavy shape would let a translator
 *  silently drop content. */
export interface SafetySection {
  /** Section heading (an <h2> at the render site). */
  title: string;
  /** One idea per entry, in the order a visitor does them. */
  steps: string[];
  /** The single thing that most often goes wrong. Optional, but if `en` has
   *  one then `es` must too — the parity test enforces that. */
  note?: string;
}

/** The whole safety slice. Adding a key here without adding it to BOTH halves
 *  is a type error; adding it with an empty string is a test failure. */
export interface SafetyStrings {
  walkOn: SafetySection;
  driveOn: SafetySection;
  returnTrip: SafetySection;
  parkingPay: SafetySection;
  restrooms: SafetySection;
  help: SafetySection;
}

/** Section render order — one list, so /simple and /es cannot drift apart. */
export const SAFETY_SECTION_ORDER = [
  "walkOn",
  "driveOn",
  "returnTrip",
  "parkingPay",
  "restrooms",
  "help",
] as const satisfies readonly (keyof SafetyStrings)[];

const en: SafetyStrings = {
  walkOn: {
    title: "Riding the boat without a car",
    steps: [
      "Walking onto the ferry is the simple way. There is always room for people on foot.",
      "If you drove here, park first. Use the paid Port lot by the marina, or a Diamond lot.",
      "Do not leave your car in the free 2-hour row. The Port asks ferry riders to stay out of it.",
      "Walk down to the ferry building at the bottom of the hill.",
      "You do not pay in Kingston. Walk on board.",
      "You pay on the Edmonds side. A round trip on foot costs $11.35 in total.",
    ],
    note: "Bikes go on with the walk-on riders.",
  },
  driveOn: {
    title: "Taking your car on the boat",
    steps: [
      "If you are driving onto the boat, do not park. You wait in a line of cars instead.",
      "The line starts on Highway 104, also called SR 104. Follow the signs to the ferry.",
      "In the busy season the line uses boarding passes, every day from 8 am to 8 pm.",
      "Watch for the flashing sign at Barber Cutoff Rd. Flashing means the pass system is on.",
      "Take a pass from the machine near Lindvog Rd.",
      "Stay in the line. If you leave the line, your pass stops working.",
      "Wait for a green light. Then drive up to the toll booths and pay there.",
    ],
    note: "You cannot reserve a spot for a car on this route. In summer, come early.",
  },
  returnTrip: {
    title: "Getting back to Edmonds",
    steps: [
      "The car ferry crosses back to Edmonds many times a day.",
      "This site shows the next boats. Check the times before you walk down to the dock.",
      "We do not print a last boat time here. It changes with the season and with repairs.",
      "Confirm the last trip of the day with Washington State Ferries before you make plans.",
      "Call 511 inside Washington, or 888-808-7977 from anywhere.",
    ],
    note: "The fast boat to Seattle is a different boat. It does not run on Sundays and it stops early in the evening. For an evening trip home, go through Edmonds.",
  },
  parkingPay: {
    title: "How to pay for parking",
    steps: [
      "The Port lot by the marina is paid parking. You buy a block of hours.",
      "You can pay at the machine in the lot, or from your phone.",
      "To pay from your phone, read the sign first. It shows a word and a short number.",
      "Send a text message with that word to that short number.",
      "The reply asks for your license plate and how long you are staying. Answer it.",
      "Keep the last message. It is your receipt.",
      "The free row nearest the shops has a 2-hour limit, and it is checked often.",
    ],
    note: "The sign on the pole is the rule. If a sign and this page disagree, believe the sign.",
  },
  restrooms: {
    title: "Restrooms",
    steps: [
      "There are public restrooms on the waterfront walkway by the Port marina, near the boat launch.",
      "It is a short, flat walk from the ferry dock.",
      "Cafes and restaurants keep their restrooms for customers.",
    ],
  },
  help: {
    title: "Who to call",
    steps: [
      "Greater Kingston Chamber of Commerce: 360-860-2239. A person answers during office hours.",
      "Washington State Ferries, for boat times: call 511 inside Washington, or 888-808-7977.",
      "Kitsap Transit, for buses and the fast boat to Seattle: 800-501-7433.",
      "In an emergency, call 911.",
    ],
    note: "Write these numbers down. Paper still works when a phone battery does not.",
  },
};

const es: SafetyStrings = {
  walkOn: {
    title: "Viajar en el ferry sin carro",
    steps: [
      "Subir al ferry a pie es lo más sencillo. Siempre hay lugar para las personas que van a pie.",
      "Si llegó en carro, primero estaciónelo. Use el estacionamiento de pago del Port, junto a la marina, o un lote de Diamond.",
      "No deje su carro en la fila gratis de 2 horas. El Port pide que los pasajeros del ferry no la usen.",
      "Baje caminando hasta el edificio del ferry, al final de la bajada.",
      "En Kingston no se paga. Suba al barco.",
      "Se paga del lado de Edmonds. El viaje de ida y vuelta a pie cuesta $11.35 en total.",
    ],
    note: "Las bicicletas suben junto con los pasajeros a pie.",
  },
  driveOn: {
    title: "Subir su carro al ferry",
    steps: [
      "Si va a subir el carro al barco, no estacione. En vez de eso, espera en una fila de carros.",
      "La fila empieza en la carretera 104, que también se llama SR 104. Siga los letreros hacia el ferry.",
      "En temporada alta la fila usa pases de abordaje, todos los días de 8 am a 8 pm.",
      "Fíjese en el letrero que parpadea en Barber Cutoff Rd. Si parpadea, el sistema de pases está funcionando.",
      "Tome un pase en la máquina que está cerca de Lindvog Rd.",
      "Quédese en la fila. Si sale de la fila, su pase deja de servir.",
      "Espere la luz verde. Después avance hasta las casetas de cobro y pague ahí.",
    ],
    note: "En esta ruta no se puede reservar lugar para el carro. En verano, llegue temprano.",
  },
  returnTrip: {
    title: "Regresar a Edmonds",
    steps: [
      "El ferry de carros cruza de regreso a Edmonds muchas veces al día.",
      "Este sitio muestra los próximos barcos. Revise los horarios antes de bajar al muelle.",
      "Aquí no publicamos la hora del último barco. Esa hora cambia según la temporada y las reparaciones.",
      "Confirme el último viaje del día con Washington State Ferries antes de hacer planes.",
      "Llame al 511 dentro del estado de Washington, o al 888-808-7977 desde cualquier lugar.",
    ],
    note: "El barco rápido a Seattle es otro barco. No navega los domingos y termina temprano por la tarde. Para regresar de noche, vaya por Edmonds.",
  },
  parkingPay: {
    title: "Cómo pagar el estacionamiento",
    steps: [
      "El estacionamiento del Port, junto a la marina, es de pago. Usted compra un bloque de horas.",
      "Puede pagar en la máquina del estacionamiento, o desde su teléfono.",
      "Para pagar desde el teléfono, primero lea el letrero. Ahí aparece una palabra y un número corto.",
      "Mande un mensaje de texto con esa palabra a ese número corto.",
      "La respuesta le pide la placa de su carro y cuánto tiempo se va a quedar. Contéstela.",
      "Guarde el último mensaje. Ese es su comprobante.",
      "La fila gratis más cercana a las tiendas tiene un límite de 2 horas, y la revisan seguido.",
    ],
    note: "El letrero del poste es la regla. Si el letrero y esta página no coinciden, hágale caso al letrero.",
  },
  restrooms: {
    title: "Baños",
    steps: [
      "Hay baños públicos en el andador junto a la marina del Port, cerca de la rampa para botes.",
      "Es una caminata corta y plana desde el muelle del ferry.",
      "Los cafés y restaurantes guardan sus baños para sus clientes.",
    ],
  },
  help: {
    title: "A quién llamar",
    steps: [
      "Greater Kingston Chamber of Commerce: 360-860-2239. Una persona contesta en horas de oficina.",
      "Washington State Ferries, para horarios de los barcos: llame al 511 dentro de Washington, o al 888-808-7977.",
      "Kitsap Transit, para los autobuses y el barco rápido a Seattle: 800-501-7433.",
      "En una emergencia, llame al 911.",
    ],
    note: "Anote estos números en papel. El papel sigue sirviendo cuando el teléfono se queda sin batería.",
  },
};

/** The whole slice, both languages. Import this, never the halves directly —
 *  a call site that reaches for `en` alone is how the two drift. */
export const SAFETY_CONTENT: { en: SafetyStrings; es: SafetyStrings } = { en, es };

/** BCP-47 tags for the `lang` attribute each half must be rendered inside
 *  (WCAG 3.1.2 — a screen reader switches voice on this and nothing else). */
export const SAFETY_LANG = { en: "en", es: "es" } as const;
