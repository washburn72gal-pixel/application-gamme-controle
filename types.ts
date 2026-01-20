
export enum ControlTool {
  PIED_A_COULISSE = 'Pied à coulisse',
  MICROMETRE_EXT = 'Micromètre extérieur',
  MICROMETRE_INT = 'Micromètre intérieur',
  MMT = 'MMT (Machine de mesure tridimensionnelle)',
  PIGE = 'Pige',
  CALIBRE = 'Calibre à mâchoires / Tampon',
  PROJECTEUR = 'Projecteur de profil',
  COMPARATEUR = 'Comparateur'
}

export interface Dimension {
  id: string;
  label: string;
  nominal: string;
  toleranceUpper: string; 
  toleranceLower: string; 
  isCritical: boolean;
  geometricTolerance?: string;
  suggestedTool: ControlTool;
  measuredValue?: string; 
}

export interface AnalysisState {
  status: 'idle' | 'analyzing' | 'completed' | 'error';
  data: Dimension[];
  error?: string;
  pdfUrl?: string; 
  planImage?: string; // Image haute résolution du plan pour l'affichage et l'impression
}
