#!/usr/bin/env python3
"""
ALPASFARM: Smart Goat & Sheep Real-Time AI Camera Scanner & Health Screening Tool
Multi-Stage Pipeline:
1. Phone / Webcam Camera Input (or Video/Image Source)
2. Object Detection & Pose Tracking (14 Anatomical Keypoints)
3. Species Verification: Goat/Sheep vs "Hindi ito kambing o tupa."
4. Real-time Posture & Movement Observation (Spine curvature, head drop, limb symmetry)
5. Farm Decision Support & Record Linking Helper
6. Strict Debouncing & Cooldown Filter (prevents false flickers)
7. 9:16 Portrait Mobile UI Preview Overlay

NOTE: This system is a decision-support and health screening tool.
It does NOT replace a licensed veterinarian or offer definitive veterinary diagnoses.
"""

import argparse
import sys
import time
import math
import os
from collections import deque
from pathlib import Path

import cv2
import numpy as np

# 14 Keypoint Schema (0-indexed)
KEYPOINT_NAMES = [
    "nose", "eye_left", "eye_right", "hornbase_left", "hornbase_right",
    "eartip_left", "eartip_right", "backline_shoulder", "tail_base",
    "tail_tip", "carpus_left", "carpus_right", "tarsus_left", "tarsus_right"
]

# Skeleton connections for rendering (pairs of 0-indexed keypoints)
SKELETON_PAIRS = [
    (0, 1), (0, 2),          # Nose -> Eyes
    (1, 3), (2, 4),          # Eyes -> Hornbases
    (1, 5), (2, 6),          # Eyes -> Eartips
    (3, 5), (4, 6),          # Hornbases -> Eartips
    (0, 7),                  # Nose -> Backline Shoulder
    (7, 8),                  # Backline Shoulder -> Tail Base
    (8, 9),                  # Tail Base -> Tail Tip
    (7, 10), (7, 11),        # Shoulder -> Carpus (Front Limbs)
    (8, 12), (8, 13)         # Tail Base -> Tarsus (Rear Limbs)
]

# Color Palette (BGR)
COLOR_PRIMARY_GREEN = (46, 175, 80)     # Healthy Green
COLOR_WARNING_AMBER = (0, 170, 255)     # Amber Alert
COLOR_DANGER_RED = (60, 60, 230)        # Red Alarm
COLOR_ACCENT_BLUE = (255, 180, 0)       # Blue Track
COLOR_BG_DARK = (24, 24, 27)            # Dark Background
COLOR_TEXT_WHITE = (255, 255, 255)
COLOR_TEXT_MUTED = (160, 160, 160)
COLOR_NOT_ANIMAL = (100, 100, 245)      # Banner for non-goat/sheep

class TemporalPostureBuffer:
    """Stabilizes detection and posture findings over time using a sliding window."""
    def __init__(self, window_size=10):
        self.window_size = window_size
        self.history = deque(maxlen=window_size)
        self.last_confirmed_status = "NORMAL"
        self.consecutive_abnormal_count = 0

    def update(self, is_abnormal: bool, finding_type: str = ""):
        self.history.append((is_abnormal, finding_type))
        abnormal_votes = sum(1 for item in self.history if item[0])
        
        # Debounce rule: require >= 60% of frames in window to assert anomaly
        if abnormal_votes >= int(self.window_size * 0.6):
            self.last_confirmed_status = "ABNORMAL"
            self.consecutive_abnormal_count += 1
        elif abnormal_votes <= int(self.window_size * 0.2):
            self.last_confirmed_status = "NORMAL"
            self.consecutive_abnormal_count = 0

        return self.last_confirmed_status

def calculate_angle_3pts(p1, p2, p3):
    """Calculates angle (in degrees) at p2 given points p1, p2, p3 (x, y)."""
    v1 = np.array([p1[0] - p2[0], p1[1] - p2[1]])
    v2 = np.array([p3[0] - p2[0], p3[1] - p2[1]])
    
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 180.0
    
    cos_theta = np.dot(v1, v2) / (norm1 * norm2)
    cos_theta = np.clip(cos_theta, -1.0, 1.0)
    angle = np.degrees(np.arccos(cos_theta))
    return float(angle)

def analyze_goat_posture(kpts, kpt_confs, bbox):
    """
    Evaluates body posture and movement observations:
    - Kyphosis (hunched back): Spine angle between head/nose, shoulder, and tail base
    - Head droop (lethargy/depression): Nose position compared to shoulder & knees
    - Limb asymmetry (possible lameness/uneven weight bearing)
    """
    findings = []
    is_abnormal = False
    details = {}

    # Check keypoint visibilities & confidences
    # 0: nose, 7: shoulder, 8: tail_base, 10: carpus_l, 11: carpus_r, 12: tarsus_l, 13: tarsus_r
    has_head = kpt_confs[0] > 0.35
    has_shoulder = kpt_confs[7] > 0.35
    has_tail = kpt_confs[8] > 0.35
    has_front_limbs = (kpt_confs[10] > 0.35 or kpt_confs[11] > 0.35)
    has_rear_limbs = (kpt_confs[12] > 0.35 or kpt_confs[13] > 0.35)

    # 1. Kyphosis / Spine Curvature Analysis
    if has_head and has_shoulder and has_tail:
        spine_angle = calculate_angle_3pts(kpts[0], kpts[7], kpts[8])
        details['spine_angle'] = round(spine_angle, 1)
        # In normal lateral posture, angle nose-shoulder-tail is typically 135°-175°
        # A sharply arched/hunched back reduces angle < 115° or has elevated shoulder relative to body axis
        if spine_angle < 115.0:
            findings.append("Posibleng Nakukubang Likod (Arched Spine / Kyphosis - Bantayan ang pananakit o parasitismo)")
            is_abnormal = True

    # 2. Head Droop / Lethargy Observation
    if has_head and has_shoulder:
        head_y = kpts[0][1]
        shoulder_y = kpts[7][1]
        # If head is drooping far below shoulder (> 30% of animal bounding box height)
        bw_h = max(1.0, bbox[3])
        head_drop_ratio = (head_y - shoulder_y) / bw_h
        details['head_drop_ratio'] = round(head_drop_ratio, 2)
        if head_drop_ratio > 0.35:
            findings.append("Nakalaylay na Ulo (Head Droop - Obserbahan ang dehydration o pananamlay)")
            is_abnormal = True

    # 3. Limb Symmetry / Weight-Bearing Balance
    if kpt_confs[10] > 0.35 and kpt_confs[11] > 0.35:
        front_limb_diff = abs(kpts[10][1] - kpts[11][1]) / max(1.0, bbox[3])
        details['front_limb_asymmetry'] = round(front_limb_diff, 2)
        if front_limb_diff > 0.25:
            findings.append("Hindi Pantay na Timbang sa Harapang Binti (Front Limb Asymmetry)")
            is_abnormal = True

    return is_abnormal, findings, details

def draw_hud(frame, detections, fps, is_not_goat=False, portrait_mode=False):
    """Draws rich mobile-inspired UI overlay with stats, animal tracking, and health screening advice."""
    h, w = frame.shape[:2]
    
    # Header Bar
    cv2.rectangle(frame, (0, 0), (w, 60), COLOR_BG_DARK, -1)
    cv2.line(frame, (0, 60), (w, 60), (60, 60, 65), 1)

    # Title & Badge
    cv2.putText(frame, "ALPASFARM AI HEALTH SCANNER", (20, 36),
                cv2.FONT_HERSHEY_DUPLEX, 0.75, COLOR_TEXT_WHITE, 2, cv2.LINE_AA)
    
    fps_text = f"FPS: {fps:.1f} | Live Stream"
    cv2.putText(frame, fps_text, (w - 240, 36),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, COLOR_TEXT_MUTED, 1, cv2.LINE_AA)

    # If Not Goat / Sheep Warning Banner
    if is_not_goat:
        banner_h = 70
        banner_y = 80
        cv2.rectangle(frame, (20, banner_y), (w - 20, banner_y + banner_h), (20, 20, 160), -1)
        cv2.rectangle(frame, (20, banner_y), (w - 20, banner_y + banner_h), (60, 60, 240), 2)
        cv2.putText(frame, "[ PAUNAWA ] Hindi ito kambing o tupa.", (40, banner_y + 30),
                    cv2.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(frame, "Iharap ang camera sa kambing o tupa upang masuri ang tindig at kalusugan.",
                    (40, banner_y + 55), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (220, 220, 255), 1, cv2.LINE_AA)

    # Bottom Dashboard Panel
    panel_h = 130
    panel_y = h - panel_h
    cv2.rectangle(frame, (0, panel_y), (w, h), COLOR_BG_DARK, -1)
    cv2.line(frame, (0, panel_y), (w, panel_y), (60, 60, 65), 1)

    num_goats = len(detections)
    animal_status_text = f"Na-detect na Hayop: {num_goats} kambing" if num_goats > 0 else "Naghahanap ng kambing o tupa..."
    cv2.putText(frame, animal_status_text, (20, panel_y + 30),
                cv2.FONT_HERSHEY_DUPLEX, 0.65, COLOR_TEXT_WHITE, 1, cv2.LINE_AA)

    # Screening Summary & Disclaimer
    if num_goats > 0:
        abnormal_total = sum(1 for d in detections if d['status'] == 'ABNORMAL')
        if abnormal_total == 0:
            health_badge = "STATUS: Normal ang Nakikitang Tindig at Postura"
            badge_color = COLOR_PRIMARY_GREEN
        else:
            health_badge = f"STATUS: {abnormal_total} Hayop na May Naobserbahang Di-Karaniwang Postura"
            badge_color = COLOR_WARNING_AMBER
        
        cv2.putText(frame, health_badge, (20, panel_y + 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, badge_color, 2, cv2.LINE_AA)
        
        # Display latest finding
        all_findings = []
        for d in detections:
            all_findings.extend(d['findings'])
        
        if all_findings:
            finding_snippet = "Payo: " + all_findings[0][:80]
            cv2.putText(frame, finding_snippet, (20, panel_y + 85),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 220, 255), 1, cv2.LINE_AA)
        else:
            cv2.putText(frame, "Payo: Ipagpatuloy ang regular na pagpapakain at malinis na tubig.",
                        (20, panel_y + 85), cv2.FONT_HERSHEY_SIMPLEX, 0.45, COLOR_TEXT_MUTED, 1, cv2.LINE_AA)

    # Veterinary Disclaimer
    disclaimer = "* Screening & research tool lamang. HINDI pamalit sa lisensyadong beterinaryo."
    cv2.putText(frame, disclaimer, (20, panel_y + 115),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (130, 130, 140), 1, cv2.LINE_AA)

    return frame

def run_scanner(args):
    root_dir = Path(__file__).parent.resolve()
    
    # Resolve Model Path
    model_path = args.model
    if not os.path.isabs(model_path):
        # Check ALPASFARM-Goat-Pose/best.pt or yolo11n-pose.pt
        candidate1 = root_dir / model_path
        candidate2 = root_dir / "runs" / "pose" / "alpasfarm_goat_pose" / "weights" / "best.pt"
        if candidate1.exists():
            model_path = str(candidate1)
        elif candidate2.exists():
            model_path = str(candidate2)

    print("="*60)
    print("ALPASFARM SMART GOAT & SHEEP AI SCANNER")
    print("="*60)
    print(f"Loading Model: {model_path}")
    print(f"Source: {args.source}")
    print(f"Confidence Threshold: {args.conf}")
    print("="*60)

    try:
        from ultralytics import YOLO
        model = YOLO(model_path)
    except Exception as e:
        print(f"Error loading YOLO model ({e}). Attempting fallback to 'yolo11n-pose.pt'...")
        try:
            from ultralytics import YOLO
            model = YOLO("yolo11n-pose.pt")
        except Exception as e2:
            print(f"Fatal error loading YOLO: {e2}")
            sys.exit(1)

    # Initialize Video Capture
    source = args.source
    if source.isdigit():
        source = int(source)
    
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"Error: Could not open video stream or camera source '{args.source}'.")
        sys.exit(1)

    posture_buffers = {}
    fps_time = time.time()
    fps_counter = 0
    current_fps = 0.0

    window_title = "ALPASFARM AI Goat Health Scanner"
    cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_title, 960, 720)

    print("\nScanner is running. Press 'q' or ESC to exit. Press 'p' to toggle Portrait Preview.")
    portrait_mode = args.portrait

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            if isinstance(source, str) and (source.endswith('.mp4') or source.endswith('.avi')):
                # Loop video for continuous testing
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            break

        fps_counter += 1
        if time.time() - fps_time >= 1.0:
            current_fps = fps_counter / (time.time() - fps_time)
            fps_counter = 0
            fps_time = time.time()

        h, w = frame.shape[:2]

        # Inference
        results = model(frame, conf=args.conf, verbose=False)
        
        detections = []
        is_not_goat = False

        if len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            keypoints = results[0].keypoints

            # Check classes
            classes = boxes.cls.cpu().numpy() if boxes.cls is not None else []
            confs = boxes.conf.cpu().numpy() if boxes.conf is not None else []
            xyxy = boxes.xyxy.cpu().numpy() if boxes.xyxy is not None else []

            kpt_data = keypoints.data.cpu().numpy() if keypoints is not None else []

            # If no animals or non-goat detected with high confidence
            if len(classes) == 0:
                is_not_goat = False
            else:
                for idx, (box, conf, cls_id) in enumerate(zip(xyxy, confs, classes)):
                    # In specialized model, class 0 is goat. In general COCO, 18=sheep, 19=cow, 15=cat, 16=dog, 0=person
                    # If using standard COCO model, 18=sheep, 19=cow/goat
                    is_goat_or_sheep = (int(cls_id) == 0) # 0 in ALPASFARM trained model
                    
                    x1, y1, x2, y2 = map(int, box)
                    bw = x2 - x1
                    bh = y2 - y1

                    if not is_goat_or_sheep:
                        is_not_goat = True
                        continue

                    kpts = []
                    kpt_confs = []
                    if len(kpt_data) > idx:
                        for kp in kpt_data[idx]:
                            kx, ky = kp[0], kp[1]
                            kv = kp[2] if len(kp) > 2 else 1.0
                            kpts.append((kx, ky))
                            kpt_confs.append(kv)
                    else:
                        kpts = [(0, 0)] * 14
                        kpt_confs = [0.0] * 14

                    # Ensure 14 keypoints
                    while len(kpts) < 14:
                        kpts.append((0, 0))
                        kpt_confs.append(0.0)

                    # Analyze posture
                    raw_abnormal, findings, details = analyze_goat_posture(kpts, kpt_confs, (x1, y1, bw, bh))

                    if idx not in posture_buffers:
                        posture_buffers[idx] = TemporalPostureBuffer(window_size=12)
                    
                    status = posture_buffers[idx].update(raw_abnormal, findings[0] if findings else "")

                    det_info = {
                        'id': idx + 1,
                        'bbox': (x1, y1, x2, y2),
                        'conf': float(conf),
                        'kpts': kpts,
                        'kpt_confs': kpt_confs,
                        'status': status,
                        'findings': findings,
                        'details': details
                    }
                    detections.append(det_info)

                    # Draw Bounding Box & Status Indicator
                    box_color = COLOR_PRIMARY_GREEN if status == "NORMAL" else COLOR_WARNING_AMBER
                    cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)

                    tag_text = f"Goat #{idx+1} ({conf:.0%}) - {status}"
                    (tw, th), _ = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                    cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 10, y1), box_color, -1)
                    cv2.putText(frame, tag_text, (x1 + 5, y1 - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, COLOR_TEXT_WHITE, 1, cv2.LINE_AA)

                    # Draw Skeleton
                    for p1_idx, p2_idx in SKELETON_PAIRS:
                        if p1_idx < len(kpts) and p2_idx < len(kpts):
                            if kpt_confs[p1_idx] > 0.35 and kpt_confs[p2_idx] > 0.35:
                                pt1 = (int(kpts[p1_idx][0]), int(kpts[p1_idx][1]))
                                pt2 = (int(kpts[p2_idx][0]), int(kpts[p2_idx][1]))
                                cv2.line(frame, pt1, pt2, (0, 240, 255), 2, cv2.LINE_AA)

                    # Draw Keypoints Joints
                    for k_i, ((kx, ky), kc) in enumerate(zip(kpts, kpt_confs)):
                        if kc > 0.35:
                            pt = (int(kx), int(ky))
                            joint_color = (0, 255, 0) if k_i in [0, 7, 8] else (255, 100, 0)
                            cv2.circle(frame, pt, 4, joint_color, -1, cv2.LINE_AA)
                            cv2.circle(frame, pt, 6, (255, 255, 255), 1, cv2.LINE_AA)

        # Draw Overlay HUD
        display_frame = draw_hud(frame, detections, current_fps, is_not_goat=is_not_goat, portrait_mode=portrait_mode)

        # Portrait 9:16 crop / letterbox preview mode
        if portrait_mode:
            target_w = int(h * 9 / 16)
            if target_w < w:
                start_x = (w - target_w) // 2
                display_frame = display_frame[:, start_x:start_x + target_w]

        cv2.imshow(window_title, display_frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q') or key == 27:
            break
        elif key == ord('p'):
            portrait_mode = not portrait_mode
            print(f"Toggled Portrait Preview Mode: {'ON (9:16)' if portrait_mode else 'OFF'}")

    cap.release()
    cv2.destroyAllWindows()
    print("Scanner session ended.")

def main():
    parser = argparse.ArgumentParser(description="ALPASFARM AI Real-Time Goat Scanner")
    parser.add_argument("--source", default="0", help="Camera index (e.g. 0), video file, or image file")
    parser.add_argument("--model", default="best.pt", help="Path to YOLO Pose model (.pt or .onnx)")
    parser.add_argument("--conf", type=float, default=0.35, help="Confidence threshold")
    parser.add_argument("--portrait", action="store_true", help="Start in 9:16 mobile portrait preview mode")

    args = parser.parse_args()
    run_scanner(args)

if __name__ == '__main__':
    main()
