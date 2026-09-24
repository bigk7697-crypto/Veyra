export type VeyraColor = "violet" | "jaune" | "bleu";

export const COLOR_HEX: Record<VeyraColor, string> = {
  violet: "#8B5CF6",
  jaune: "#FACC15",
  bleu: "#3B82F6",
};

export const ALL_COLORS: VeyraColor[] = ["violet", "jaune", "bleu"];

export type VeyraMotif = "etoile" | "rond" | "triangle";

export const ALL_MOTIFS: VeyraMotif[] = ["etoile", "rond", "triangle"];

export const MOTIF_MARK: Record<VeyraMotif, string> = {
  etoile: "★",
  rond: "●",
  triangle: "▲",
};

export interface ChallengeCell {
  index: number;
  letter: string;
  color: VeyraColor;
  colorHex: string;
  motif: VeyraMotif;
  mark: string;
}

interface RawCell {
  letter: string;
  color: VeyraColor;
  motif: VeyraMotif;
  isTarget: boolean;
  targetOrder: number; // position dans le mot secret, -1 si distracteur
}

export function cleanSecretWord(word: string): string {
  return word
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);
}

function randInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomLetter(exclude: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPRSTUVWXYZ"; // sans O,Q pour lisibilité
  for (let k = 0; k < 50; k++) {
    const c = alphabet[randInt(alphabet.length)];
    if (!exclude.has(c)) return c;
  }
  return "X";
}

function wrongColor(correct: VeyraColor): VeyraColor {
  const others = ALL_COLORS.filter((c) => c !== correct);
  return others[randInt(others.length)];
}

export function cleanMotif(m: string): VeyraMotif {
  const v = m.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (v === "etoile" || v === "star") return "etoile";
  if (v === "rond" || v === "cercle" || v === "circle") return "rond";
  if (v === "triangle") return "triangle";
  return "etoile";
}

function wrongMotif(correct: VeyraMotif): VeyraMotif {
  const others = ALL_MOTIFS.filter((m) => m !== correct);
  return others[randInt(others.length)];
}

/**
 * Règle V1 : pour chaque lettre du secret, une cellule cible
 * (lettre + couleur user + motif user). Complété à 9 cellules avec distracteurs :
 * - soit lettre du secret dans une mauvaise couleur et/ou mauvais motif (piège)
 * - soit lettre hors-secret dans couleur/motif aléatoires
 * Positions mélangées à chaque génération.
 */
export function buildGrid(
  secretWord: string,
  userColor: VeyraColor,
  userMotif: VeyraMotif = "etoile"
): { cells: ChallengeCell[]; solution: number[] } {
  const secret = cleanSecretWord(secretWord);
  const secretSet = new Set(secret.split(""));
  const raw: RawCell[] = [];

  secret.split("").forEach((letter, order) => {
    raw.push({ letter, color: userColor, motif: userMotif, isTarget: true, targetOrder: order });
  });

  while (raw.length < 9) {
    if (Math.random() < 0.5) {
      // piège : bonne lettre, mauvaise couleur et/ou mauvais motif
      const letter = secret[randInt(secret.length)];
      const useWrongColor = Math.random() < 0.7;
      const useWrongMotif = Math.random() < 0.5;
      raw.push({
        letter,
        color: useWrongColor ? wrongColor(userColor) : userColor,
        motif: useWrongMotif ? wrongMotif(userMotif) : userMotif,
        isTarget: false,
        targetOrder: -1,
      });
    } else {
      raw.push({
        letter: randomLetter(secretSet),
        color: ALL_COLORS[randInt(3)],
        motif: ALL_MOTIFS[randInt(3)],
        isTarget: false,
        targetOrder: -1,
      });
    }
  }

  const shuffled = shuffle(raw);
  const cells: ChallengeCell[] = shuffled.map((c, index) => ({
    index,
    letter: c.letter,
    color: c.color,
    colorHex: COLOR_HEX[c.color],
    motif: c.motif,
    mark: MOTIF_MARK[c.motif],
  }));

  // Solution = indices des cibles, triés dans l'ordre du mot secret.
  // Le client doit cliquer dans l'ordre du secret.
  const solution: number[] = [];
  const orderedTargets = shuffled
    .map((c, index) => ({ ...c, index }))
    .filter((c) => c.isTarget)
    .sort((a, b) => a.targetOrder - b.targetOrder)
    .map((c) => c.index);

  for (const idx of orderedTargets) solution.push(idx);

  return { cells, solution };
}
