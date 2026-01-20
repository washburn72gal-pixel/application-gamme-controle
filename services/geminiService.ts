
import { GoogleGenAI, Type } from "@google/genai";
import { Dimension, ControlTool } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const dimensionSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      label: { type: Type.STRING, description: "Nom ou description de la cote (ex: Diamètre extérieur, Épaisseur)" },
      nominal: { type: Type.STRING, description: "Valeur nominale (ex: 20.0)" },
      toleranceUpper: { type: Type.STRING, description: "Tolérance supérieure (ex: +0.05). Mets '0' si absent." },
      toleranceLower: { type: Type.STRING, description: "Tolérance inférieure (ex: -0.02). Mets '0' si absent." },
      isCritical: { type: Type.BOOLEAN, description: "Est-ce une cote critique ?" },
      geometricTolerance: { type: Type.STRING, description: "Tolérance géométrique ou spécification GPS (ex: Parallélisme 0.05). Laisse VIDE si absent." },
      suggestedTool: { 
        type: Type.STRING, 
        description: "Moyen de contrôle suggéré parmi: Pied à coulisse, Micromètre extérieur, Micromètre intérieur, MMT, Pige, Calibre, Projecteur de profil, Comparateur" 
      },
    },
    required: ["label", "nominal", "toleranceUpper", "toleranceLower", "isCritical", "suggestedTool"],
  },
};

export const analyzeDrawing = async (pdfBase64: string): Promise<Dimension[]> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            text: `Analyse ce plan technique. Extrais les cotes et tolérances. 
            RÈGLES CRITIQUES:
            1. Pour 'geometricTolerance', laisse le champ VIDE si aucune info GPS n'est trouvée.
            2. Ne mets jamais 'null', 'N/A' ou 'vide' dans les champs.
            3. Identifie les cotes critiques (marquées d'un cadre, d'un symbole spécial ou tolérances très serrées).`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: dimensionSchema,
      },
    });

    const results = JSON.parse(response.text || "[]");
    return results.map((item: any, index: number) => ({
      ...item,
      id: `dim-${index}-${Date.now()}`,
    }));
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw new Error("Erreur d'analyse.");
  }
};
