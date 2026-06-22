// Structured report templates for imaging modalities.
// These are scaffolds a radiologist/sonographer inserts into the Findings /
// Impression fields, then edits. Bilingual so the bilingual print stays populated.
// Frontend-only — no schema change; the report itself is still free text.

export interface ReportTemplate {
  id: string;
  label: string;       // shown in the picker (English)
  findings: string;
  impression: string;
  findingsAr?: string;
  impressionAr?: string;
}

export const xrayTemplates: ReportTemplate[] = [
  {
    id: "normal_chest",
    label: "Normal Chest",
    findings:
      "The lungs are clear and well expanded. No focal consolidation, pleural effusion or pneumothorax. " +
      "Cardiac silhouette is normal in size. Mediastinal contours are unremarkable. Bony thorax is intact.",
    impression: "Normal chest radiograph.",
    findingsAr:
      "الرئتان صافيتان ومتمددتان بشكل جيد. لا يوجد تكثف بؤري أو انصباب جنبي أو استرواح صدري. " +
      "حجم ظل القلب طبيعي. المنصف غير ملحوظ. القفص الصدري العظمي سليم.",
    impressionAr: "صورة صدر شعاعية طبيعية.",
  },
  {
    id: "pneumonia",
    label: "Pneumonia / Consolidation",
    findings:
      "There is air-space opacification in the ____ lobe consistent with consolidation. " +
      "No significant pleural effusion. Remainder of the lungs are clear. Cardiac silhouette is normal.",
    impression: "Findings consistent with ____ lobe pneumonia. Clinical correlation advised.",
    findingsAr:
      "يوجد تكثف في الفص ____ يتوافق مع التهاب رئوي. لا يوجد انصباب جنبي يُذكر. باقي الرئتين صافٍ. ظل القلب طبيعي.",
    impressionAr: "نتائج تتوافق مع التهاب رئوي في الفص ____. يُنصح بالربط السريري.",
  },
  {
    id: "normal_extremity",
    label: "Normal Bone / Extremity",
    findings:
      "No fracture, dislocation or bony destructive lesion. Joint spaces are preserved. " +
      "Soft tissues are unremarkable. No radio-opaque foreign body.",
    impression: "No acute bony abnormality.",
    findingsAr:
      "لا يوجد كسر أو خلع أو آفة عظمية تدميرية. المسافات المفصلية محفوظة. الأنسجة الرخوة غير ملحوظة. لا يوجد جسم غريب ظليل.",
    impressionAr: "لا يوجد خلل عظمي حاد.",
  },
  {
    id: "fracture",
    label: "Fracture",
    findings:
      "There is a ____ fracture of the ____ with ____ mm displacement / angulation. " +
      "The articular surface is ____. Surrounding soft tissue swelling is noted.",
    impression: "____ fracture of the ____. Orthopedic correlation advised.",
    findingsAr:
      "يوجد كسر ____ في ____ مع إزاحة / انحناء بمقدار ____ مم. السطح المفصلي ____. يُلاحظ تورم في الأنسجة الرخوة المحيطة.",
    impressionAr: "كسر ____ في ____. يُنصح بالتقييم العظمي.",
  },
  {
    id: "normal_abdomen",
    label: "Normal Abdomen (KUB)",
    findings:
      "Non-obstructed bowel gas pattern. No abnormal calcification or radio-opaque calculus. " +
      "No free intraperitoneal air. Visualized bony structures are intact.",
    impression: "Unremarkable abdominal radiograph.",
    findingsAr:
      "نمط غازات أمعاء غير معوق. لا يوجد تكلس غير طبيعي أو حصوة ظليلة. لا يوجد هواء حر داخل الصفاق. الهياكل العظمية المرئية سليمة.",
    impressionAr: "صورة بطن شعاعية غير ملحوظة.",
  },
];

export const ultrasoundTemplates: ReportTemplate[] = [
  {
    id: "normal_abdominal",
    label: "Normal Abdominal",
    findings:
      "Liver is normal in size and echotexture with no focal lesion. Gallbladder is unremarkable with no calculus or wall thickening. " +
      "CBD is not dilated. Pancreas, spleen and both kidneys are normal. No free fluid.",
    impression: "Normal abdominal ultrasound.",
    findingsAr:
      "الكبد طبيعي الحجم والنسيج الصدوي بدون آفة بؤرية. المرارة غير ملحوظة بدون حصوات أو سماكة جدار. " +
      "القناة الصفراوية المشتركة غير متوسعة. البنكرياس والطحال والكليتان طبيعية. لا يوجد سائل حر.",
    impressionAr: "تصوير بطن بالموجات فوق الصوتية طبيعي.",
  },
  {
    id: "cholelithiasis",
    label: "Cholelithiasis (Gallstones)",
    findings:
      "Gallbladder contains ____ mobile echogenic focus / foci with posterior acoustic shadowing. " +
      "Gallbladder wall measures ____ mm. No pericholecystic fluid. CBD measures ____ mm.",
    impression: "Cholelithiasis. No sonographic evidence of acute cholecystitis.",
    findingsAr:
      "تحتوي المرارة على ____ بؤرة صدوية متحركة مع ظل صوتي خلفي. سماكة جدار المرارة ____ مم. " +
      "لا يوجد سائل حول المرارة. القناة الصفراوية المشتركة ____ مم.",
    impressionAr: "حصوات مرارية. لا يوجد دليل صوتي على التهاب مرارة حاد.",
  },
  {
    id: "normal_obstetric",
    label: "Obstetric (Single Viable)",
    findings:
      "Single live intrauterine gestation. Fetal heart rate ____ bpm. " +
      "Gestational age ____ weeks by biometry. Placenta is ____ in position. Amniotic fluid is adequate.",
    impression: "Single viable intrauterine pregnancy, ____ weeks.",
    findingsAr:
      "حمل حي مفرد داخل الرحم. معدل ضربات قلب الجنين ____ نبضة/دقيقة. " +
      "العمر الحملي ____ أسبوع حسب القياسات. المشيمة في وضع ____. السائل الأمنيوسي كافٍ.",
    impressionAr: "حمل مفرد حيّ داخل الرحم، ____ أسبوع.",
  },
  {
    id: "normal_pelvic",
    label: "Normal Pelvic",
    findings:
      "Uterus is normal in size and echotexture. Endometrial thickness ____ mm. " +
      "Both ovaries are normal in size with no abnormal cyst or mass. No free fluid in the pouch of Douglas.",
    impression: "Normal pelvic ultrasound.",
    findingsAr:
      "الرحم طبيعي الحجم والنسيج الصدوي. سماكة بطانة الرحم ____ مم. " +
      "المبيضان طبيعيان الحجم بدون كيس أو كتلة غير طبيعية. لا يوجد سائل حر في جيب دوغلاس.",
    impressionAr: "تصوير حوض بالموجات فوق الصوتية طبيعي.",
  },
  {
    id: "normal_thyroid",
    label: "Normal Thyroid",
    findings:
      "Both thyroid lobes are normal in size and echotexture with no focal nodule. " +
      "Isthmus measures ____ mm. No abnormal cervical lymphadenopathy.",
    impression: "Normal thyroid ultrasound.",
    findingsAr:
      "فصا الغدة الدرقية طبيعيان الحجم والنسيج الصدوي بدون عقيدة بؤرية. " +
      "البرزخ يقيس ____ مم. لا يوجد اعتلال عقد لمفية رقبية غير طبيعي.",
    impressionAr: "تصوير غدة درقية بالموجات فوق الصوتية طبيعي.",
  },
];
