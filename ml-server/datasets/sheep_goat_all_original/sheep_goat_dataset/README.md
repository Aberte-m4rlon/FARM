# Barn sheep/goat dataset (source: 5590.mp4)
- 107 frames, 1 per 10 s, 1280x720, night-vision grayscale, fixed camera. Frame N time = 10:30:33 PM + 10*(N-1) s, 2026-08-06
- Classes: 0 sheep, 1 goat (lambs/kids are labeled with their species by visual guess)
- ALL frames have a YOLO label file (labels/) and entries in annotations_coco.json
- Sources (metadata.csv `source`): 11 hand-drawn seed frames (1,10,20,30,40,45,60,80,90,100,106); the rest were propagated
  by template matching and then visually reviewed/corrected by hand.
- Boxes are approximate (visual estimates). Heavily occluded animals at the back of the herd are often unlabeled.
  Goat vs sheep for small kids and partially visible animals is uncertain. Treat as weak labels; refine in CVAT/Label Studio.
- qa_overlays/ : every frame with boxes drawn (green sheep, red goat)
- splits/ : time-based, train frames 1-75, val frames 76-107
- preannotations/ : old motion proposals, reference only
