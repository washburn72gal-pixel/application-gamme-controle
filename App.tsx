
import React, { useState, useMemo, useRef } from 'react';
import { analyzeDrawing } from './services/geminiService';
import { Dimension, AnalysisState, ControlTool } from './types';
import ToolSelect from './components/ToolSelect';
// @ts-ignore
import * as pdfjs from 'pdfjs-dist';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// Configuration du worker pdf.js
pdfjs.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.mjs';

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [operatorName, setOperatorName] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  
  const [analysis, setAnalysis] = useState<AnalysisState>({
    status: 'idle',
    data: [],
  });

  const renderPdfToImage = async (pdfFile: File) => {
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      
      const viewport = page.getViewport({ scale: 2.0 }); 
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return null;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error("Erreur de rendu PDF:", error);
      return null;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!projectName) setProjectName(selectedFile.name.replace('.pdf', ''));
      
      const planImage = await renderPdfToImage(selectedFile);
      
      setAnalysis({ 
        status: 'idle', 
        data: [], 
        pdfUrl: URL.createObjectURL(selectedFile),
        planImage: planImage || undefined
      });
    }
  };

  const startAnalysis = async () => {
    if (!file) return;
    setAnalysis(prev => ({ ...prev, status: 'analyzing' }));
    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
      });
      const results = await analyzeDrawing(base64);
      setAnalysis(prev => ({ ...prev, status: 'completed', data: results }));
    } catch (err) {
      setAnalysis(prev => ({ ...prev, status: 'error', error: "Erreur lors de l'analyse." }));
    }
  };

  const exportToPdf = async () => {
    if (!reportRef.current) return;
    setIsExporting(true);
    
    try {
      const element = reportRef.current;
      
      // On force une largeur fixe pour la capture afin de garantir une échelle prévisible
      // 800px est une bonne base pour un rendu propre sur A4
      const originalWidth = element.style.width;
      element.style.width = '850px'; 
      
      const canvas = await html2canvas(element, {
        scale: 2, // Haute résolution
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 850,
      });
      
      // On restaure le style original
      element.style.width = originalWidth;

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const margin = 10; // 10mm de marge
      const contentWidth = pdfWidth - (margin * 2);
      
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * contentWidth) / imgProps.width;
      
      // Si le contenu est plus long qu'une page A4, on gère le découpage ou le redimensionnement
      // Ici, on centre horizontalement et verticalement sur la première page
      let yPos = (pdfHeight - imgHeight) / 2;
      
      // Si l'image est trop haute pour être centrée verticalement (dépasse le haut)
      if (yPos < margin) yPos = margin;

      pdf.addImage(imgData, 'PNG', margin, yPos, contentWidth, imgHeight);
      
      // Si ça dépasse en bas, on pourrait ajouter une page, mais pour une fiche de contrôle 
      // on privilégie souvent une vue d'ensemble propre. 
      // Ajoutons une vérification pour les rapports très longs :
      if (imgHeight > pdfHeight - (margin * 2)) {
          // Si vraiment trop long, on peut envisager un export multi-pages, 
          // mais ici on va simplement s'assurer que le contenu principal est là.
          console.warn("Le rapport est très long pour une seule page A4.");
      }

      pdf.save(`Rapport_Metrologie_${projectName || 'Export'}.pdf`);
    } catch (error) {
      console.error("Export Error:", error);
      alert("Une erreur est survenue lors de la génération du PDF.");
    } finally {
      setIsExporting(false);
    }
  };

  const updateDim = (id: string, up: Partial<Dimension>) => {
    setAnalysis(prev => ({ ...prev, data: prev.data.map(d => d.id === id ? { ...d, ...up } : d) }));
  };

  const addLine = () => {
    setAnalysis(prev => ({
      ...prev,
      data: [...prev.data, {
        id: `m-${Date.now()}`, label: 'Nouvelle cote', nominal: '0', 
        toleranceUpper: '0', toleranceLower: '0', isCritical: false,
        suggestedTool: ControlTool.PIED_A_COULISSE, measuredValue: ''
      }]
    }));
  };

  const checkStatus = (d: Dimension) => {
    if (!d.measuredValue) return 'none';
    const v = parseFloat(d.measuredValue.replace(',', '.'));
    const n = parseFloat(d.nominal.replace(',', '.'));
    const max = n + parseFloat((d.toleranceUpper || '0').replace('+', '').replace(',', '.'));
    const min = n + parseFloat((d.toleranceLower || '0').replace(',', '.'));
    return (!isNaN(v) && v >= min && v <= max) ? 'ok' : 'nok';
  };

  const removeLine = (id: string) => {
    setAnalysis(prev => ({ ...prev, data: prev.data.filter(d => d.id !== id) }));
  };

  const stats = useMemo(() => {
    const total = analysis.data.length;
    const filled = analysis.data.filter(d => !!d.measuredValue).length;
    const ok = analysis.data.filter(d => checkStatus(d) === 'ok').length;
    const nok = analysis.data.filter(d => checkStatus(d) === 'nok').length;
    return { total, filled, ok, nok, percent: filled > 0 ? Math.round((ok/filled)*100) : 0 };
  }, [analysis.data]);

  return (
    <div className="min-h-screen bg-slate-100 pb-10 font-sans text-slate-900">
      {/* Barre de navigation */}
      <header className="bg-white border-b border-slate-200 p-4 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 text-white p-1 rounded font-black text-sm">AI</div>
            <h1 className="font-bold text-lg tracking-tight uppercase">Métrologie Expert</h1>
          </div>
          <div className="flex gap-2">
            {analysis.status === 'completed' && (
              <button 
                onClick={exportToPdf} 
                disabled={isExporting}
                className={`${isExporting ? 'bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'} text-white px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-100`}
              >
                {isExporting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                )}
                {isExporting ? 'GÉNÉRATION PDF...' : 'EXPORTER RAPPORT (A4)'}
              </button>
            )}
            <label className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-bold cursor-pointer transition-all active:scale-95 shadow-sm">
              CHARGER NOUVEAU PLAN
              <input type="file" className="hidden" accept="application/pdf" onChange={handleFileChange} />
            </label>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 space-y-6">
        
        {/* Paramètres Rapport (Saisie Utilisateur) */}
        {file && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:grid md:grid-cols-2 gap-6 items-end">
            <div className="w-full">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Désignation du Projet / Affaire</label>
              <input 
                type="text" 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Ex: SUPPORT_MOTEUR_V2"
              />
            </div>
            <div className="w-full">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Nom de l'Opérateur (Prénom NOM)</label>
              <input 
                type="text" 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                placeholder="Ex: Jean DUPONT"
              />
            </div>
            {analysis.status === 'idle' && (
              <div className="md:col-span-2 w-full flex justify-center mt-2">
                <button onClick={startAnalysis} className="bg-blue-600 text-white px-16 py-4 rounded-2xl font-black text-lg shadow-xl hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  LANCER L'ANALYSE PAR L'IA
                </button>
              </div>
            )}
          </div>
        )}

        {analysis.status === 'analyzing' && (
          <div className="py-24 text-center space-y-6">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto shadow-sm"></div>
            <p className="font-black text-slate-400 uppercase text-xs tracking-[0.2em] animate-pulse">Traitement algorithmique du plan en cours...</p>
          </div>
        )}

        {/* Résultats de la Fiche de Contrôle */}
        {analysis.status === 'completed' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            {/* ZONE DE CAPTURE POUR LE PDF */}
            <div className="flex justify-center">
              <div 
                ref={reportRef} 
                className="bg-white shadow-2xl border border-slate-200 overflow-hidden w-full max-w-[850px]"
                style={{ minHeight: '1100px' }} // Proche du ratio A4 pour le rendu visuel
              >
                {/* Header Rapport Professionnel */}
                <div className="p-10 bg-slate-900 text-white flex justify-between items-start">
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-3xl font-black leading-tight uppercase tracking-tight">Fiche de Contrôle Métrologique</h2>
                      <p className="text-blue-400 text-[10px] font-bold tracking-[0.2em] uppercase mt-1">Rapport automatisé de conformité qualité</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-x-12 gap-y-4 text-[10px] font-bold uppercase">
                      <div className="space-y-1">
                        <span className="text-slate-500 block">Projet / Affaire</span>
                        <span className="text-white text-base font-black truncate max-w-[250px] inline-block">{projectName || "—"}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-slate-500 block">Date d'inspection</span>
                        <span className="text-white text-base font-black">{new Date().toLocaleDateString('fr-FR')}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-slate-500 block">Fichier source</span>
                        <span className="text-white text-xs font-black truncate max-w-[250px] inline-block">{file?.name}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-slate-500 block">Contrôleur responsable</span>
                        <span className="text-white text-base font-black border-b border-blue-800 pb-1 inline-block min-w-[150px]">
                          {operatorName || "À remplir..."}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right flex flex-col items-end">
                     <div className="bg-blue-600/20 border border-blue-500/30 p-4 rounded-2xl flex flex-col items-center">
                        <div className="text-[10px] font-black text-blue-400 mb-1 tracking-widest uppercase">Indice de Conformité</div>
                        <div className={`text-5xl font-black ${stats.percent === 100 ? 'text-emerald-400' : 'text-white'}`}>{stats.percent}<span className="text-2xl opacity-50">%</span></div>
                     </div>
                  </div>
                </div>

                {/* Section Plan Technique (Priorité Visuelle) */}
                {analysis.planImage && (
                  <div className="bg-slate-50 p-8 border-b border-slate-200">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                       <div className="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
                       Référence du plan technique
                    </div>
                    <div className="w-full flex justify-center bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm p-4 min-h-[300px]">
                      <img 
                        src={analysis.planImage} 
                        alt="Plan Technique" 
                        className="object-contain w-full h-full max-h-[500px]" 
                      />
                    </div>
                  </div>
                )}

                {/* Tableau de Contrôle des Cotes */}
                <div className="p-8">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                     <div className="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
                     Détails des mesures et tolérances
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase border-b border-slate-200">
                          <th className="p-4 border-r border-slate-100">Désignation / Spécification GPS</th>
                          <th className="p-4 w-28 border-r border-slate-100 text-center">Nominal</th>
                          <th className="p-4 w-32 border-r border-slate-100 text-center">Tolérances</th>
                          <th className="p-4 w-44 border-r border-slate-100">Moyen de contrôle</th>
                          <th className="p-4 w-48 bg-blue-50/50 text-blue-900 text-center">Mesure Réelle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[11px]">
                        {analysis.data.map((d) => {
                          const st = checkStatus(d);
                          const hasGPS = d.geometricTolerance && 
                                         d.geometricTolerance.toLowerCase() !== "null" && 
                                         d.geometricTolerance.trim() !== "";
                          
                          return (
                            <tr key={d.id} className={`${d.isCritical ? 'bg-amber-50/20' : ''} hover:bg-slate-50/50 transition-colors`}>
                              <td className="p-4 border-r border-slate-50">
                                <input 
                                  className="w-full bg-transparent border-none font-bold text-slate-800 focus:ring-0 p-0 uppercase outline-none" 
                                  value={d.label} 
                                  onChange={e => updateDim(d.id, {label: e.target.value})} 
                                />
                                {hasGPS && (
                                  <div className="text-[8px] text-blue-600 font-black mt-1 uppercase bg-blue-50 inline-block px-1.5 py-0.5 rounded italic">
                                    {d.geometricTolerance}
                                  </div>
                                )}
                              </td>
                              <td className="p-4 font-mono font-black text-slate-700 border-r border-slate-50 text-center">
                                <input 
                                  className="w-full bg-transparent border-none focus:ring-0 p-0 text-center outline-none" 
                                  value={d.nominal} 
                                  onChange={e => updateDim(d.id, {nominal: e.target.value})} 
                                />
                              </td>
                              <td className="p-4 font-mono text-[9px] border-r border-slate-50">
                                <div className="flex flex-col leading-tight items-center">
                                  <input className="text-emerald-700 font-black bg-transparent border-none p-0 h-4 focus:ring-0 w-full text-center outline-none" value={d.toleranceUpper} onChange={e => updateDim(d.id, {toleranceUpper: e.target.value})} />
                                  <input className="text-rose-700 font-black bg-transparent border-none p-0 h-4 focus:ring-0 w-full text-center outline-none" value={d.toleranceLower} onChange={e => updateDim(d.id, {toleranceLower: e.target.value})} />
                                </div>
                              </td>
                              <td className="p-4 border-r border-slate-50">
                                <ToolSelect value={d.suggestedTool} onChange={v => updateDim(d.id, {suggestedTool: v as ControlTool})} />
                              </td>
                              <td className="p-4 bg-blue-50/10">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    placeholder="---"
                                    className={`w-full bg-white border ${st === 'ok' ? 'border-emerald-500 ring-2 ring-emerald-100' : st === 'nok' ? 'border-rose-500 ring-2 ring-rose-100' : 'border-slate-300'} rounded-lg px-3 py-2 font-black text-center text-xs shadow-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all`}
                                    value={d.measuredValue || ''}
                                    onChange={e => updateDim(d.id, {measuredValue: e.target.value})}
                                  />
                                  {st === 'ok' && <span className="text-[9px] font-black text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full">CONFORME</span>}
                                  {st === 'nok' && <span className="text-[9px] font-black text-rose-600 bg-rose-100 px-2 py-1 rounded-full">NON-CONF</span>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Section Signature et Bilan Qualité */}
                <div className="mt-auto p-12 border-t border-slate-100 bg-slate-50 grid grid-cols-3 gap-16">
                   <div className="space-y-2">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Décision Finale</div>
                      <div className={`text-2xl font-black ${stats.percent === 100 ? 'text-emerald-600' : 'text-slate-800'}`}>
                         {stats.percent === 100 ? 'PIÈCE ACCEPTÉE' : 'SOUS RÉSERVE'}
                      </div>
                      <p className="text-[9px] text-slate-500 leading-relaxed italic">
                         Conformité basée sur les mesures saisies par l'opérateur vis-à-vis des tolérances extraites du plan.
                      </p>
                   </div>
                   
                   <div className="space-y-2">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Bilan des Cotes</div>
                      <div className="flex items-baseline gap-2">
                         <span className="text-3xl font-black text-slate-800">{stats.ok}</span>
                         <span className="text-slate-400 font-bold text-sm">sur {stats.total} conformes</span>
                      </div>
                      <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                         <div className="bg-emerald-500 h-full" style={{ width: `${stats.percent}%` }}></div>
                      </div>
                   </div>

                   <div className="space-y-4 border-l border-slate-200 pl-16">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Visa Validation</div>
                      <div className="border-b-2 border-slate-300 h-16 relative bg-white/50 rounded-t-lg">
                         <span className="absolute bottom-1 right-2 text-[8px] font-bold text-slate-300 uppercase">Tampon & Signature</span>
                      </div>
                      <div className="text-[9px] text-center text-slate-400 font-bold">{operatorName || "NOM DE L'OPÉRATEUR"}</div>
                   </div>
                </div>
                
                <div className="p-4 bg-slate-900 text-white/30 text-[8px] font-bold text-center uppercase tracking-[0.5em]">
                   Généré par Métrologie-AI Expert • Document confidentiel • Page 1/1
                </div>
              </div>
            </div>

            <div className="max-w-[850px] mx-auto">
              <button 
                onClick={addLine} 
                className="w-full py-5 border-2 border-dashed border-slate-300 rounded-2xl text-slate-400 font-black text-xs uppercase hover:bg-white hover:text-slate-600 hover:border-blue-300 hover:shadow-lg transition-all flex items-center justify-center gap-3"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                Ajouter manuellement une spécification de contrôle
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
