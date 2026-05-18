/* ============================================
   Key-Value Mapper JavaScript - Key-Value 맵핑 로직
   ============================================ */

// State
let kvCurrentImage = null; // {file: File, dataUrl: string, filename: string, width: number, height: number}
let kvAnnotations = []; // 새 구조: [{id, type, bbox, text, key_id?}, ...]
let kvNextId = 1; // 다음 어노테이션 ID
let kvCurrentKeyId = null; // 현재 작업 중인 Key의 ID (Value 추가 시 사용)
let kvMode = 'key'; // 'key', 'value', 'etc'
let kvIsDrawing = false;
let kvStartX = 0, kvStartY = 0;
let kvMouseDownTime = 0; // 클릭/드래그 구분용
let kvClickTimer = null; // 클릭/더블클릭 구분용
let kvSelectedId = null; // 선택된 박스 ID
let kvIsResizing = false; // 리사이즈 중인지
let kvResizeHandle = null; // 현재 리사이즈 핸들 ('nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w')
let kvResizeStartX = 0, kvResizeStartY = 0; // 리사이즈 시작 좌표
let kvOriginalBbox = null; // 리사이즈 전 원본 bbox
const KV_HANDLE_SIZE = 10; // 리사이즈 핸들 크기

let kvIsDragging = false; // bbox 이동 중인지
let kvDragStartX = 0, kvDragStartY = 0; // 이동 시작 좌표

// Zoom State
let kvZoomLevel = 1;
const KV_ZOOM_MIN = 0.5;
const KV_ZOOM_MAX = 5;
const KV_ZOOM_STEP = 0.1;

// DOM Elements
const kvUploadArea = document.getElementById('kvUploadArea');
const kvImageInput = document.getElementById('kvImageInput');
const kvUploadCard = document.getElementById('kvUploadCard');
const kvViewerContainer = document.getElementById('kvViewerContainer');
const kvHelpCard = document.getElementById('kvHelpCard');
const kvImage = document.getElementById('kvImage');
const kvCanvas = document.getElementById('kvCanvas');
const kvCanvasContainer = document.getElementById('kvCanvasContainer');
const kvSelectionBox = document.getElementById('kvSelectionBox');
const kvFilename = document.getElementById('kvFilename');
const kvModeValue = document.getElementById('kvModeValue');
const kvLabelsList = document.getElementById('kvLabelsList');
const kvClearLabelsBtn = document.getElementById('kvClearLabelsBtn');
const kvSaveBtn = document.getElementById('kvSaveBtn');
const kvSaveInfo = document.getElementById('kvSaveInfo');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupKvEventListeners();
});

function setupKvEventListeners() {
    // 이미지 업로드 이벤트
    if (kvUploadArea) {
        kvUploadArea.addEventListener('click', () => kvImageInput.click());
        kvUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            kvUploadArea.classList.add('drag-over');
        });
        kvUploadArea.addEventListener('dragleave', () => {
            kvUploadArea.classList.remove('drag-over');
        });
        kvUploadArea.addEventListener('drop', handleKvDrop);
    }
    
    if (kvImageInput) {
        kvImageInput.addEventListener('change', handleKvFileSelect);
    }
    
    if (kvClearLabelsBtn) {
        kvClearLabelsBtn.addEventListener('click', clearCurrentLabels);
    }
    
    if (kvSaveBtn) {
        kvSaveBtn.addEventListener('click', saveKvAnnotations);
    }
    
    // JSON 불러오기 이벤트
    const kvLoadBtn = document.getElementById('kvLoadBtn');
    const kvJsonInput = document.getElementById('kvJsonInput');
    
    if (kvLoadBtn && kvJsonInput) {
        kvLoadBtn.addEventListener('click', () => kvJsonInput.click());
        kvJsonInput.addEventListener('change', handleKvJsonLoad);
    }
    
    // 대용량 처리 버튼: 클릭 시 JSON 파일 선택 → 검증 후 대용량 처리 페이지로 이동
    const kvBatchBtn = document.getElementById('kvBatchBtn');
    const kvBatchJsonInput = document.getElementById('kvBatchJsonInput');
    
    if (kvBatchBtn && kvBatchJsonInput) {
        kvBatchBtn.addEventListener('click', () => kvBatchJsonInput.click());
        kvBatchJsonInput.addEventListener('change', handleKvBatchJsonSelect);
    }
    
    // 줌 버튼 이벤트
    const kvZoomIn = document.getElementById('kvZoomIn');
    const kvZoomOut = document.getElementById('kvZoomOut');
    const kvZoomReset = document.getElementById('kvZoomReset');
    
    if (kvZoomIn) {
        kvZoomIn.addEventListener('click', () => {
            kvZoomLevel = Math.min(KV_ZOOM_MAX, kvZoomLevel + KV_ZOOM_STEP * 2);
            applyKvZoom();
            updateZoomIndicator();
        });
    }
    if (kvZoomOut) {
        kvZoomOut.addEventListener('click', () => {
            kvZoomLevel = Math.max(KV_ZOOM_MIN, kvZoomLevel - KV_ZOOM_STEP * 2);
            applyKvZoom();
            updateZoomIndicator();
        });
    }
    if (kvZoomReset) {
        kvZoomReset.addEventListener('click', resetKvZoom);
    }
    
    // 키보드 이벤트
    document.addEventListener('keydown', handleKvKeydown);
    
    // 캔버스 드래그 이벤트 설정
    setupKvCanvasEvents();
}

function setupKvCanvasEvents() {
    if (!kvCanvasContainer) return;
    
    kvCanvasContainer.addEventListener('mousedown', startKvDrawing);
    kvCanvasContainer.addEventListener('mousemove', updateKvDrawing);
    kvCanvasContainer.addEventListener('mouseup', endKvDrawing);
    kvCanvasContainer.addEventListener('mouseleave', endKvDrawing);
    kvCanvasContainer.addEventListener('dblclick', handleBoxDoubleClick);  // 더블클릭 텍스트 입력
    
    // 마우스 휠 줌 이벤트
    const canvasWrapper = document.getElementById('kvCanvasWrapper');
    if (canvasWrapper) {
        canvasWrapper.addEventListener('wheel', handleKvZoom, { passive: false });
    }
}

// ============================================
// File Handling
// ============================================

function handleKvDrop(e) {
    e.preventDefault();
    kvUploadArea.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files).filter(file => 
        file.type.startsWith('image/')
    );
    
    if (files.length > 0) {
        processKvFile(files[0]);
    }
}

function handleKvFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        processKvFile(file);
    }
}

async function processKvFile(file) {
    CommonUtils.showLoading('이미지 로딩 중...');
    
    try {
        const dataUrl = await CommonUtils.readFileAsDataURL(file);
        
        // 이미지 크기 가져오기
        const img = new Image();
        img.src = dataUrl;
        await new Promise(resolve => img.onload = resolve);
        
        kvCurrentImage = {
            file: file,
            filename: file.name,
            dataUrl: dataUrl,
            width: img.naturalWidth,
            height: img.naturalHeight
        };
        
        // 상태 초기화
        kvAnnotations = [];
        kvNextId = 1;
        kvCurrentKeyId = null;
        kvMode = 'key';
        
        // UI 업데이트
        if (kvViewerContainer) kvViewerContainer.hidden = false;
        if (kvUploadCard) kvUploadCard.style.display = 'none';
        if (kvHelpCard) kvHelpCard.style.display = 'none';
        
        loadCurrentKvImage();
        
    } catch (error) {
        alert('로드 오류: ' + error.message);
    } finally {
        CommonUtils.hideLoading();
    }
}

function loadCurrentKvImage() {
    if (!kvCurrentImage || !kvImage) return;
    
    // 줌 리셋
    resetKvZoom();
    
    kvImage.src = kvCurrentImage.dataUrl;
    kvImage.onload = () => {
        // 캔버스 크기 맞추기
        if (kvCanvas) {
            kvCanvas.width = kvImage.naturalWidth;
            kvCanvas.height = kvImage.naturalHeight;
            kvCanvas.style.width = kvImage.width + 'px';
            kvCanvas.style.height = kvImage.height + 'px';
        }
        
        drawAnnotationsOnCanvas();
        renderKvLabels();
    };
    
    // UI 업데이트
    if (kvFilename) kvFilename.textContent = kvCurrentImage.filename;
    updateKvModeIndicator();
}

// ============================================
// Keyboard Handling
// ============================================

function handleKvKeydown(e) {
    // 현재 Key-Value 페이지에 있는지 확인
    if (!kvCurrentImage) return;
    
    // 입력 필드에 포커스가 있으면 무시
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    switch (e.key) {
        case 'Escape':
            // 새 Key 시작 (Key 모드로 전환)
            kvMode = 'key';
            kvCurrentKeyId = null;
            updateKvModeIndicator();
            break;
        case 'e':
        case 'E':
            // etc 모드 토글
            kvMode = kvMode === 'etc' ? 'key' : 'etc';
            if (kvMode === 'etc') kvCurrentKeyId = null;
            updateKvModeIndicator();
            break;
        case 'Delete':
        case 'Backspace':
            // 선택된 박스가 있으면 삭제, 없으면 마지막 라벨 삭제
            if (kvSelectedId !== null) {
                deleteSelectedBox();
            } else {
                deleteLastLabel();
            }
            e.preventDefault();
            break;
    }
}

// ============================================
// Mode Indicator
// ============================================

function updateKvModeIndicator() {
    if (!kvModeValue) return;
    
    const keyCount = kvAnnotations.filter(a => a.type === 'key').length;
    const etcCount = kvAnnotations.filter(a => a.type === 'etc').length;
    
    if (kvMode === 'etc') {
        kvModeValue.textContent = `ETC ${etcCount + 1}`;
        kvModeValue.className = 'mode-value is-etc';
    } else if (kvMode === 'key') {
        kvModeValue.textContent = `Key ${keyCount + 1}`;
        kvModeValue.className = 'mode-value is-key';
    } else {
        // value 모드
        const valueCount = kvAnnotations.filter(a => a.type === 'value' && a.key_id === kvCurrentKeyId).length;
        kvModeValue.textContent = `Value ${valueCount + 1}`;
        kvModeValue.className = 'mode-value is-value';
    }
}

// ============================================
// Zoom Handling
// ============================================

function handleKvZoom(e) {
    if (!kvCurrentImage) return;
    
    e.preventDefault();
    
    const delta = e.deltaY > 0 ? -KV_ZOOM_STEP : KV_ZOOM_STEP;
    const newZoom = Math.max(KV_ZOOM_MIN, Math.min(KV_ZOOM_MAX, kvZoomLevel + delta));
    
    if (newZoom !== kvZoomLevel) {
        kvZoomLevel = newZoom;
        applyKvZoom();
        updateZoomIndicator();
    }
}

function applyKvZoom() {
    if (!kvCanvasContainer) return;
    
    kvCanvasContainer.style.transform = `scale(${kvZoomLevel})`;
    kvCanvasContainer.style.transformOrigin = 'center top';
    
    // 확대 시 inner 컨테이너 크기 조정 (스크롤 영역 확보)
    const canvasInner = document.querySelector('.kv-canvas-inner');
    if (canvasInner && kvImage) {
        const scaledWidth = kvImage.width * kvZoomLevel;
        const scaledHeight = kvImage.height * kvZoomLevel;
        canvasInner.style.minWidth = scaledWidth + 'px';
        canvasInner.style.minHeight = scaledHeight + 'px';
    }
}

function resetKvZoom() {
    kvZoomLevel = 1;
    applyKvZoom();
    updateZoomIndicator();
}

function updateZoomIndicator() {
    const indicator = document.getElementById('kvZoomLevel');
    if (indicator) {
        indicator.textContent = `${Math.round(kvZoomLevel * 100)}%`;
    }
}

// ============================================
// Canvas Drawing
// ============================================

function startKvDrawing(e) {
    if (!kvCurrentImage || !kvCanvasContainer) return;
    
    const rect = kvCanvasContainer.getBoundingClientRect();
    // 줌 레벨 고려한 스케일 계산
    const displayWidth = kvImage.width * kvZoomLevel;
    const displayHeight = kvImage.height * kvZoomLevel;
    const scaleX = kvImage.naturalWidth / displayWidth;
    const scaleY = kvImage.naturalHeight / displayHeight;
    
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    // 리사이즈 핸들 클릭 확인
    const handle = findHandleAtPos(mouseX, mouseY);
    if (handle && kvSelectedId !== null) {
        kvIsResizing = true;
        kvResizeHandle = handle.type;
        kvResizeStartX = mouseX;
        kvResizeStartY = mouseY;
        const ann = kvAnnotations.find(a => a.id === kvSelectedId);
        if (ann) {
            kvOriginalBbox = [...ann.bbox];
        }
        return;
    }
    
    // 선택된 bbox 내부 클릭 시 이동 모드
    if (kvSelectedId !== null) {
        const selectedAnn = kvAnnotations.find(a => a.id === kvSelectedId);
        if (selectedAnn) {
            const bbox = selectedAnn.bbox;
            if (mouseX >= bbox[0] && mouseX <= bbox[2] &&
                mouseY >= bbox[1] && mouseY <= bbox[3]) {
                kvIsDragging = true;
                kvDragStartX = mouseX;
                kvDragStartY = mouseY;
                kvOriginalBbox = [...selectedAnn.bbox];
                if (kvCanvasContainer) {
                    kvCanvasContainer.style.cursor = 'move';
                }
                return;
            }
        }
    }
    
    kvStartX = mouseX;
    kvStartY = mouseY;
    kvIsDrawing = true;
    kvMouseDownTime = Date.now();
    
    if (kvSelectionBox) {
        kvSelectionBox.hidden = false;
        kvSelectionBox.style.left = ((e.clientX - rect.left) / kvZoomLevel) + 'px';
        kvSelectionBox.style.top = ((e.clientY - rect.top) / kvZoomLevel) + 'px';
        kvSelectionBox.style.width = '0px';
        kvSelectionBox.style.height = '0px';
    }
}

function updateKvDrawing(e) {
    if (!kvCanvasContainer) return;
    
    const rect = kvCanvasContainer.getBoundingClientRect();
    const displayWidth = kvImage.width * kvZoomLevel;
    const displayHeight = kvImage.height * kvZoomLevel;
    const scaleX = kvImage.naturalWidth / displayWidth;
    const scaleY = kvImage.naturalHeight / displayHeight;
    
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    // 리사이즈 중
    if (kvIsResizing && kvSelectedId !== null && kvOriginalBbox) {
        const ann = kvAnnotations.find(a => a.id === kvSelectedId);
        if (!ann) return;
        
        const dx = mouseX - kvResizeStartX;
        const dy = mouseY - kvResizeStartY;
        const newBbox = [...kvOriginalBbox];
        
        switch (kvResizeHandle) {
            case 'nw':
                newBbox[0] = Math.round(kvOriginalBbox[0] + dx);
                newBbox[1] = Math.round(kvOriginalBbox[1] + dy);
                break;
            case 'n':
                newBbox[1] = Math.round(kvOriginalBbox[1] + dy);
                break;
            case 'ne':
                newBbox[2] = Math.round(kvOriginalBbox[2] + dx);
                newBbox[1] = Math.round(kvOriginalBbox[1] + dy);
                break;
            case 'e':
                newBbox[2] = Math.round(kvOriginalBbox[2] + dx);
                break;
            case 'se':
                newBbox[2] = Math.round(kvOriginalBbox[2] + dx);
                newBbox[3] = Math.round(kvOriginalBbox[3] + dy);
                break;
            case 's':
                newBbox[3] = Math.round(kvOriginalBbox[3] + dy);
                break;
            case 'sw':
                newBbox[0] = Math.round(kvOriginalBbox[0] + dx);
                newBbox[3] = Math.round(kvOriginalBbox[3] + dy);
                break;
            case 'w':
                newBbox[0] = Math.round(kvOriginalBbox[0] + dx);
                break;
        }
        
        // 최소 크기 보장
        if (newBbox[2] - newBbox[0] >= 20 && newBbox[3] - newBbox[1] >= 20) {
            // x1 < x2, y1 < y2 보장
            ann.bbox = [
                Math.min(newBbox[0], newBbox[2]),
                Math.min(newBbox[1], newBbox[3]),
                Math.max(newBbox[0], newBbox[2]),
                Math.max(newBbox[1], newBbox[3])
            ];
            drawAnnotationsOnCanvas();
        }
        return;
    }
    
    // bbox 이동 중
    if (kvIsDragging && kvSelectedId !== null && kvOriginalBbox) {
        const ann = kvAnnotations.find(a => a.id === kvSelectedId);
        if (!ann) return;
        
        const dx = mouseX - kvDragStartX;
        const dy = mouseY - kvDragStartY;
        
        ann.bbox = [
            Math.round(kvOriginalBbox[0] + dx),
            Math.round(kvOriginalBbox[1] + dy),
            Math.round(kvOriginalBbox[2] + dx),
            Math.round(kvOriginalBbox[3] + dy)
        ];
        drawAnnotationsOnCanvas();
        return;
    }
    
    // 일반 드래그 (새 박스 그리기)
    if (!kvIsDrawing || !kvSelectionBox) return;
    
    const currentX = (e.clientX - rect.left) / kvZoomLevel;
    const currentY = (e.clientY - rect.top) / kvZoomLevel;
    
    const displayScaleX = kvImage.width / kvImage.naturalWidth;
    const displayScaleY = kvImage.height / kvImage.naturalHeight;
    
    const startXScaled = kvStartX * displayScaleX;
    const startYScaled = kvStartY * displayScaleY;
    
    const width = Math.abs(currentX - startXScaled);
    const height = Math.abs(currentY - startYScaled);
    const left = Math.min(currentX, startXScaled);
    const top = Math.min(currentY, startYScaled);
    
    kvSelectionBox.style.left = left + 'px';
    kvSelectionBox.style.top = top + 'px';
    kvSelectionBox.style.width = width + 'px';
    kvSelectionBox.style.height = height + 'px';
    
    // 커서 변경
    updateKvCursor(mouseX, mouseY);
}

function updateKvCursor(mouseX, mouseY) {
    if (!kvCanvasContainer) return;
    
    const handle = findHandleAtPos(mouseX, mouseY);
    if (handle) {
        kvCanvasContainer.style.cursor = handle.cursor;
    } else {
        kvCanvasContainer.style.cursor = 'crosshair';
    }
}

function endKvDrawing(e) {
    // 리사이즈 완료
    if (kvIsResizing) {
        kvIsResizing = false;
        kvResizeHandle = null;
        kvOriginalBbox = null;
        renderKvLabels();
        if (kvCanvasContainer) kvCanvasContainer.style.cursor = 'crosshair';
        return;
    }
    
    // bbox 이동 완료
    if (kvIsDragging) {
        kvIsDragging = false;
        kvOriginalBbox = null;
        renderKvLabels();
        if (kvCanvasContainer) kvCanvasContainer.style.cursor = 'crosshair';
        return;
    }
    
    if (!kvIsDrawing) return;
    kvIsDrawing = false;
    
    if (kvSelectionBox) kvSelectionBox.hidden = true;
    
    if (!kvCanvasContainer) return;
    
    const rect = kvCanvasContainer.getBoundingClientRect();
    // 줌 레벨 고려한 스케일 계산
    const displayWidth = kvImage.width * kvZoomLevel;
    const displayHeight = kvImage.height * kvZoomLevel;
    const scaleX = kvImage.naturalWidth / displayWidth;
    const scaleY = kvImage.naturalHeight / displayHeight;
    
    const endX = (e.clientX - rect.left) * scaleX;
    const endY = (e.clientY - rect.top) * scaleY;
    
    const x = Math.min(kvStartX, endX);
    const y = Math.min(kvStartY, endY);
    const w = Math.abs(endX - kvStartX);
    const h = Math.abs(endY - kvStartY);
    
    // 클릭 판정: 작은 이동 + 짧은 시간
    const elapsed = Date.now() - kvMouseDownTime;
    if (w < 10 && h < 10 && elapsed < 300) {
        // 클릭으로 판정 - 박스 선택 (딜레이로 더블클릭 구분)
        const clickX = kvStartX;
        const clickY = kvStartY;
        
        // 기존 타이머 취소
        if (kvClickTimer) clearTimeout(kvClickTimer);
        
        // 200ms 대기 후 단일 클릭으로 처리 (더블클릭이면 타이머가 취소됨)
        kvClickTimer = setTimeout(() => {
            handleBoxSelect(clickX, clickY);
            kvClickTimer = null;
        }, 200);
        return;
    }
    
    // 너무 작은 영역 무시 (드래그)
    if (w < 10 || h < 10) return;
    
    const box = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    
    addKvAnnotation(box);
}

// ============================================
// Box Double Click - Text Input
// ============================================

function handleBoxDoubleClick(e) {
    if (!kvCurrentImage || !kvCanvasContainer) return;
    
    // 클릭 타이머 취소 (더블클릭이므로 삭제 팝업 방지)
    if (kvClickTimer) {
        clearTimeout(kvClickTimer);
        kvClickTimer = null;
    }
    
    const rect = kvCanvasContainer.getBoundingClientRect();
    const displayWidth = kvImage.width * kvZoomLevel;
    const displayHeight = kvImage.height * kvZoomLevel;
    const scaleX = kvImage.naturalWidth / displayWidth;
    const scaleY = kvImage.naturalHeight / displayHeight;
    
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;
    
    // 클릭 위치에 있는 박스 찾기
    let foundAnn = null;
    for (let i = kvAnnotations.length - 1; i >= 0; i--) {
        const ann = kvAnnotations[i];
        const bbox = ann.bbox;
        if (clickX >= bbox[0] && clickX <= bbox[2] &&
            clickY >= bbox[1] && clickY <= bbox[3]) {
            foundAnn = ann;
            break;
        }
    }
    
    if (!foundAnn) return;
    
    // 선택하고 오른쪽 사이드 패널에서 텍스트 편집
    kvSelectedId = foundAnn.id;
    drawAnnotationsOnCanvas();
    showSideEditPanel(foundAnn);
}

// 전역 변수: 현재 편집 중인 어노테이션
let kvEditingAnn = null;

function showSideEditPanel(ann) {
    kvEditingAnn = ann;
    
    const editPanel = document.getElementById('kvEditPanel');
    const editTarget = document.getElementById('kvEditTarget');
    const editTextarea = document.getElementById('kvEditTextarea');
    const saveTextBtn = document.getElementById('kvSaveTextBtn');
    
    if (!editPanel || !editTextarea) return;
    
    const typeLabel = ann.type === 'key' ? 'Key' : 
                      ann.type === 'value' ? 'Value' : 'ETC';
    
    editTarget.textContent = `${typeLabel} #${ann.id}`;
    editTextarea.value = ann.text || '';
    editPanel.hidden = false;
    editTextarea.focus();
    
    // 저장 버튼 이벤트 (기존 이벤트 제거 후 등록)
    const newSaveBtn = saveTextBtn.cloneNode(true);
    saveTextBtn.parentNode.replaceChild(newSaveBtn, saveTextBtn);
    
    newSaveBtn.addEventListener('click', () => {
        if (kvEditingAnn) {
            kvEditingAnn.text = editTextarea.value.trim() || null;
            renderKvLabels();
            drawAnnotationsOnCanvas();
            hideSideEditPanel(); // 저장 후 패널 숨기기
        }
    });
    
    // Enter로 저장 (Shift+Enter는 줄바꿈)
    editTextarea.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (kvEditingAnn) {
                kvEditingAnn.text = editTextarea.value.trim() || null;
                renderKvLabels();
                drawAnnotationsOnCanvas();
                hideSideEditPanel(); // 저장 후 패널 숨기기
            }
        }
    };
}

function hideSideEditPanel() {
    const editPanel = document.getElementById('kvEditPanel');
    if (editPanel) {
        editPanel.hidden = true;
    }
    kvEditingAnn = null;
}

// 기존 팝업 함수 (호환성 유지용 - 실제로는 사용하지 않음)
function showTextInputPopup(ann) {
    showSideEditPanel(ann);
}

// 아래는 기존 팝업 코드 (제거됨)
function _showTextInputPopup_old(ann) {
    // 기존 팝업 제거
    const existingPopup = document.querySelector('.kv-text-popup');
    if (existingPopup) existingPopup.remove();
    
    const typeLabel = ann.type === 'key' ? 'Key' : 
                      ann.type === 'value' ? 'Value' : 'ETC';
    
    const popup = document.createElement('div');
    popup.className = 'kv-text-popup';
    popup.innerHTML = `
        <div class="kv-popup-header">
            <h4>📝 ${typeLabel} #${ann.id} 텍스트 입력</h4>
            <button class="kv-popup-close">&times;</button>
        </div>
        <div class="kv-popup-body">
            <textarea class="kv-popup-textarea" placeholder="텍스트를 입력하세요...">${ann.text || ''}</textarea>
        </div>
        <div class="kv-popup-footer">
            <button class="btn-cancel">취소</button>
            <button class="btn-save">저장</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    const textarea = popup.querySelector('.kv-popup-textarea');
    textarea.focus();
    textarea.select();
    
    // 닫기 버튼
    popup.querySelector('.kv-popup-close').addEventListener('click', () => popup.remove());
    popup.querySelector('.btn-cancel').addEventListener('click', () => popup.remove());
    
    // 저장 버튼
    popup.querySelector('.btn-save').addEventListener('click', () => {
        ann.text = textarea.value.trim() || null;
        popup.remove();
        renderKvLabels();
        drawAnnotationsOnCanvas();
    });
    
    // Enter로 저장 (Shift+Enter는 줄바꿈)
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ann.text = textarea.value.trim() || null;
            popup.remove();
            renderKvLabels();
            drawAnnotationsOnCanvas();
        }
        if (e.key === 'Escape') {
            popup.remove();
        }
    });
}

// ============================================
// Box Select
// ============================================

function handleBoxSelect(clickX, clickY) {
    // 클릭 위치에 있는 박스 찾기 (위에서부터, 나중에 그려진 것 우선)
    let foundAnn = null;
    
    for (let i = kvAnnotations.length - 1; i >= 0; i--) {
        const ann = kvAnnotations[i];
        const bbox = ann.bbox;
        if (clickX >= bbox[0] && clickX <= bbox[2] &&
            clickY >= bbox[1] && clickY <= bbox[3]) {
            foundAnn = ann;
            break;
        }
    }
    
    if (foundAnn) {
        // 박스 선택
        kvSelectedId = foundAnn.id;
    } else {
        // 빈 곳 클릭 - 선택 해제
        kvSelectedId = null;
    }
    
    drawAnnotationsOnCanvas();
}

// ============================================
// Resize Handles
// ============================================

function getResizeHandles(bbox) {
    const [x1, y1, x2, y2] = bbox;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    
    return [
        { x: x1, y: y1, type: 'nw', cursor: 'nw-resize' },
        { x: midX, y: y1, type: 'n', cursor: 'n-resize' },
        { x: x2, y: y1, type: 'ne', cursor: 'ne-resize' },
        { x: x2, y: midY, type: 'e', cursor: 'e-resize' },
        { x: x2, y: y2, type: 'se', cursor: 'se-resize' },
        { x: midX, y: y2, type: 's', cursor: 's-resize' },
        { x: x1, y: y2, type: 'sw', cursor: 'sw-resize' },
        { x: x1, y: midY, type: 'w', cursor: 'w-resize' }
    ];
}

function findHandleAtPos(x, y) {
    if (kvSelectedId === null) return null;
    
    const ann = kvAnnotations.find(a => a.id === kvSelectedId);
    if (!ann) return null;
    
    const handles = getResizeHandles(ann.bbox);
    for (const handle of handles) {
        const dist = Math.sqrt((x - handle.x) ** 2 + (y - handle.y) ** 2);
        if (dist <= KV_HANDLE_SIZE) {
            return handle;
        }
    }
    return null;
}

function drawResizeHandles(ctx, bbox) {
    const handles = getResizeHandles(bbox);
    
    handles.forEach(handle => {
        // 흰색 테두리
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(handle.x - KV_HANDLE_SIZE/2 - 1, handle.y - KV_HANDLE_SIZE/2 - 1, 
                     KV_HANDLE_SIZE + 2, KV_HANDLE_SIZE + 2);
        // 빨간색 내부
        ctx.fillStyle = '#e94560';
        ctx.fillRect(handle.x - KV_HANDLE_SIZE/2, handle.y - KV_HANDLE_SIZE/2, 
                     KV_HANDLE_SIZE, KV_HANDLE_SIZE);
    });
}

function deleteSelectedBox() {
    if (kvSelectedId === null) return;
    
    const targetAnn = kvAnnotations.find(a => a.id === kvSelectedId);
    if (!targetAnn) return;
    
    // 삭제 확인
    const typeLabel = targetAnn.type === 'key' ? 'Key' : 
                      targetAnn.type === 'value' ? 'Value' : 'ETC';
    
    if (!confirm(`이 ${typeLabel} 박스를 삭제하시겠습니까?`)) return;
    
    // Key 삭제 시 연결된 Value들도 삭제
    if (targetAnn.type === 'key') {
        kvAnnotations = kvAnnotations.filter(a => 
            a.id !== targetAnn.id && a.key_id !== targetAnn.id
        );
    } else {
        kvAnnotations = kvAnnotations.filter(a => a.id !== targetAnn.id);
    }
    
    // 선택 해제
    kvSelectedId = null;
    
    // 상태 업데이트
    if (kvAnnotations.length === 0) {
        kvNextId = 1;
        kvMode = 'key';
        kvCurrentKeyId = null;
    }
    
    updateKvModeIndicator();
    renderKvLabels();
    drawAnnotationsOnCanvas();
}

// ============================================
// Annotation Management
// ============================================

function addKvAnnotation(box) {
    // bbox 형식: [x1, y1, x2, y2]
    const bbox = [box.x, box.y, box.x + box.w, box.y + box.h];
    
    if (kvMode === 'etc') {
        // ETC 라벨 추가
        kvAnnotations.push({
            id: kvNextId++,
            type: 'etc',
            bbox: bbox,
            text: null
        });
    } else if (kvMode === 'key') {
        // Key 추가
        const newKeyId = kvNextId++;
        kvAnnotations.push({
            id: newKeyId,
            type: 'key',
            bbox: bbox,
            text: null
        });
        // 다음부터는 Value 모드
        kvCurrentKeyId = newKeyId;
        kvMode = 'value';
    } else {
        // Value 추가 (현재 Key에 연결)
        if (kvCurrentKeyId) {
            kvAnnotations.push({
                id: kvNextId++,
                type: 'value',
                key_id: kvCurrentKeyId,
                bbox: bbox,
                text: null
            });
        }
    }
    
    updateKvModeIndicator();
    renderKvLabels();
    drawAnnotationsOnCanvas();
}

function drawAnnotationsOnCanvas() {
    if (!kvCanvas) return;
    
    const ctx = kvCanvas.getContext('2d');
    ctx.clearRect(0, 0, kvCanvas.width, kvCanvas.height);
    
    // Key 번호 매핑 (id -> 순서)
    const keyIdToNum = {};
    let keyNum = 1;
    kvAnnotations.filter(a => a.type === 'key').forEach(a => {
        keyIdToNum[a.id] = keyNum++;
    });
    
    kvAnnotations.forEach((ann) => {
        const bbox = ann.bbox;
        const x = bbox[0];
        const y = bbox[1];
        const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1];
        const isSelected = ann.id === kvSelectedId;
        
        if (ann.type === 'key') {
            // Key 박스 그리기 (노란색)
            ctx.strokeStyle = isSelected ? '#ffffff' : '#fbbf24';
            ctx.lineWidth = isSelected ? 6 : 4;
            ctx.setLineDash([]);
            ctx.strokeRect(x, y, w, h);
            
            // 선택 시 추가 테두리
            if (isSelected) {
                ctx.strokeStyle = '#fbbf24';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
                ctx.setLineDash([]);
            }
            
            ctx.fillStyle = '#fbbf24';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(`key${keyIdToNum[ann.id]}`, x + 5, y + 20);
            
        } else if (ann.type === 'value') {
            // Value 박스 그리기 (초록색)
            ctx.strokeStyle = isSelected ? '#ffffff' : '#4ade80';
            ctx.lineWidth = isSelected ? 5 : 3;
            ctx.setLineDash([]);
            ctx.strokeRect(x, y, w, h);
            
            // 선택 시 추가 테두리
            if (isSelected) {
                ctx.strokeStyle = '#4ade80';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
                ctx.setLineDash([]);
            }
            
            // Value 번호 계산 (같은 key_id를 가진 value들 중 몇 번째인지)
            const sameKeyValues = kvAnnotations.filter(a => a.type === 'value' && a.key_id === ann.key_id);
            const valueNum = sameKeyValues.indexOf(ann) + 1;
            
            ctx.fillStyle = '#4ade80';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(`v${valueNum}(k${keyIdToNum[ann.key_id]})`, x + 5, y + 18);
            
        } else if (ann.type === 'etc') {
            // ETC 박스 그리기 (파란색 점선)
            ctx.strokeStyle = isSelected ? '#ffffff' : '#60a5fa';
            ctx.lineWidth = isSelected ? 5 : 3;
            ctx.setLineDash([6, 6]);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
            
            // 선택 시 추가 테두리
            if (isSelected) {
                ctx.strokeStyle = '#60a5fa';
                ctx.lineWidth = 3;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
                ctx.setLineDash([]);
            }
            
            const etcNum = kvAnnotations.filter(a => a.type === 'etc').indexOf(ann) + 1;
            ctx.fillStyle = '#60a5fa';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(`etc${etcNum}`, x + 5, y + 18);
        }
    });
    
    // 선택된 박스에 리사이즈 핸들 그리기
    if (kvSelectedId !== null) {
        const selectedAnn = kvAnnotations.find(a => a.id === kvSelectedId);
        if (selectedAnn) {
            drawResizeHandles(ctx, selectedAnn.bbox);
        }
    }
}

function renderKvLabels() {
    if (!kvLabelsList) return;
    
    if (kvAnnotations.length === 0) {
        kvLabelsList.innerHTML = '<p class="kv-no-labels">드래그하여 영역을 선택하세요</p>';
        return;
    }
    
    let html = '';
    
    // Key별로 그룹화
    const keys = kvAnnotations.filter(a => a.type === 'key');
    const etcs = kvAnnotations.filter(a => a.type === 'etc');
    
    keys.forEach((key, idx) => {
        const values = kvAnnotations.filter(a => a.type === 'value' && a.key_id === key.id);
        const keyText = key.text ? `<span class="kv-label-text">"${key.text}"</span>` : '';
        html += `
            <div class="kv-label-group" data-key-id="${key.id}">
                <div class="kv-label-key">
                    <span class="key-badge">key${idx + 1}</span>
                    ${keyText}
                    <button class="btn-delete-label" data-delete-key="${key.id}" title="이 Key 삭제">×</button>
                </div>
                <div class="kv-label-values">
                    ${values.map((v, vIdx) => {
                        const valText = v.text ? `<span class="kv-label-text">"${v.text}"</span>` : '';
                        return `
                            <span class="kv-label-value">
                                <span class="value-badge">value${vIdx + 1}</span>
                                ${valText}
                                <button class="btn-delete-label btn-delete-value" data-delete-value="${v.id}" title="이 Value 삭제">×</button>
                            </span>
                        `;
                    }).join('')}
                    ${values.length === 0 ? '<span style="color: var(--text-tertiary); font-size: 0.8rem;">값 없음</span>' : ''}
                </div>
            </div>
        `;
    });
    
    // ETC 라벨
    if (etcs.length > 0) {
        html += `<div class="kv-label-etc-section"><span class="etc-section-title">ETC 라벨</span>`;
        etcs.forEach((etc, idx) => {
            const etcText = etc.text ? `<span class="kv-label-text">"${etc.text}"</span>` : '';
            html += `
                <div class="kv-label-etc">
                    <span class="etc-badge">etc${idx + 1}</span>
                    ${etcText}
                    <button class="btn-delete-label" data-delete-etc="${etc.id}" title="이 ETC 삭제">×</button>
                </div>
            `;
        });
        html += `</div>`;
    }
    
    kvLabelsList.innerHTML = html;
    
    // 삭제 버튼 이벤트 연결
    attachDeleteButtonEvents();
}

function attachDeleteButtonEvents() {
    // Key 삭제 버튼
    document.querySelectorAll('[data-delete-key]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const keyId = parseInt(btn.dataset.deleteKey);
            deleteKeyById(keyId);
        });
    });
    
    // Value 삭제 버튼
    document.querySelectorAll('[data-delete-value]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const valueId = parseInt(btn.dataset.deleteValue);
            deleteValueById(valueId);
        });
    });
    
    // ETC 삭제 버튼
    document.querySelectorAll('[data-delete-etc]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const etcId = parseInt(btn.dataset.deleteEtc);
            deleteEtcById(etcId);
        });
    });
}

function deleteKeyById(keyId) {
    const key = kvAnnotations.find(a => a.id === keyId && a.type === 'key');
    if (!key) return;
    
    // Key와 연결된 Value들 삭제
    kvAnnotations = kvAnnotations.filter(a => a.id !== keyId && a.key_id !== keyId);
    
    // 선택 해제
    if (kvSelectedId === keyId) kvSelectedId = null;
    
    // 상태 업데이트
    if (kvAnnotations.length === 0) {
        kvNextId = 1;
        kvMode = 'key';
        kvCurrentKeyId = null;
    }
    
    updateKvModeIndicator();
    renderKvLabels();
    drawAnnotationsOnCanvas();
}

function deleteValueById(valueId) {
    kvAnnotations = kvAnnotations.filter(a => a.id !== valueId);
    
    if (kvSelectedId === valueId) kvSelectedId = null;
    
    renderKvLabels();
    drawAnnotationsOnCanvas();
}

function deleteEtcById(etcId) {
    kvAnnotations = kvAnnotations.filter(a => a.id !== etcId);
    
    if (kvSelectedId === etcId) kvSelectedId = null;
    
    renderKvLabels();
    drawAnnotationsOnCanvas();
}

function clearCurrentLabels() {
    if (!confirm('모든 라벨을 삭제하시겠습니까?')) return;
    
    kvAnnotations = [];
    kvNextId = 1;
    kvCurrentKeyId = null;
    kvMode = 'key';
    
    updateKvModeIndicator();
    renderKvLabels();
    drawAnnotationsOnCanvas();
}

function deleteLastLabel() {
    if (kvAnnotations.length === 0) return;
    
    // 마지막 어노테이션 삭제
    const lastAnn = kvAnnotations.pop();
    
    // 삭제된 게 Key였으면 연결된 Value들도 삭제
    if (lastAnn.type === 'key') {
        kvAnnotations = kvAnnotations.filter(a => a.key_id !== lastAnn.id);
        kvMode = 'key';
        kvCurrentKeyId = null;
    }
    
    // 삭제된 게 Value였으면 같은 Key의 마지막 Value 상태 유지
    if (lastAnn.type === 'value') {
        kvCurrentKeyId = lastAnn.key_id;
        kvMode = 'value';
    }
    
    // ID 재조정 (선택적)
    if (kvAnnotations.length === 0) {
        kvNextId = 1;
        kvMode = 'key';
        kvCurrentKeyId = null;
    }
    
    updateKvModeIndicator();
    renderKvLabels();
    drawAnnotationsOnCanvas();
}

// ============================================
// 대용량 처리: JSON 파일 선택 후 검증하고 배치 페이지로 이동
// ============================================
const KV_BATCH_STORAGE_KEY = 'kvBatchTemplateJson';

function handleKvBatchJsonSelect(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    const batchUrl = document.getElementById('kvBatchBtn') && document.getElementById('kvBatchBtn').getAttribute('data-batch-url');

    if (!file) {
        input.value = '';
        return;
    }

    if (!file.name.toLowerCase().endsWith('.json')) {
        alert('JSON 파일만 선택할 수 있습니다.\n(.json 확장자 파일을 선택해 주세요.)');
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        let obj;
        try {
            obj = JSON.parse(event.target.result);
        } catch (err) {
            alert('JSON 형식이 올바르지 않습니다.\n\n' + err.message);
            input.value = '';
            return;
        }

        if (!obj || typeof obj !== 'object') {
            alert('올바른 어노테이션 JSON이 아닙니다.\n(객체 또는 배열 형태여야 합니다.)');
            input.value = '';
            return;
        }

        // 배치 페이지 형식: { annotations: [...] } 또는 배열
        let template = obj;
        if (Array.isArray(obj)) {
            template = { annotations: obj };
        } else if (!obj.annotations || !Array.isArray(obj.annotations)) {
            alert('어노테이션 JSON에는 "annotations" 배열이 필요합니다.');
            input.value = '';
            return;
        }

        try {
            sessionStorage.setItem(KV_BATCH_STORAGE_KEY, JSON.stringify(template));
        } catch (err) {
            alert('파일이 너무 커서 저장할 수 없습니다.\n대용량 처리 페이지에서 직접 JSON을 업로드해 주세요.');
            input.value = '';
            return;
        }

        input.value = '';
        if (batchUrl) {
            window.location.href = batchUrl;
        }
    };
    reader.readAsText(file);
}

// ============================================
// Load Annotations (JSON 불러오기)
// ============================================

function handleKvJsonLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // 이미지가 로드되어 있지 않으면 경고
    if (!kvCurrentImage) {
        alert('먼저 이미지를 업로드해주세요.');
        e.target.value = ''; // 입력 초기화
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const jsonData = JSON.parse(event.target.result);
            loadAnnotationsFromJson(jsonData);
            
            if (kvSaveInfo) {
                kvSaveInfo.textContent = '✅ JSON 불러오기 완료!';
                setTimeout(() => {
                    kvSaveInfo.textContent = '';
                }, 3000);
            }
        } catch (error) {
            alert('JSON 파일 파싱 오류: ' + error.message);
        }
    };
    reader.readAsText(file);
    
    // 입력 초기화 (같은 파일 다시 선택 가능하도록)
    e.target.value = '';
}

function loadAnnotationsFromJson(jsonData) {
    // 새 형식 체크: {image, width, height, annotations}
    if (jsonData.annotations && Array.isArray(jsonData.annotations)) {
        kvAnnotations = jsonData.annotations;
        kvNextId = Math.max(...kvAnnotations.map(a => a.id), 0) + 1;
    }
    // 구 형식 체크: 배열
    else if (Array.isArray(jsonData)) {
        kvAnnotations = [];
        let nextId = 1;
        
        jsonData.forEach((item) => {
            // 새 형식 항목 (id, type, bbox)
            if (item.id && item.type && item.bbox) {
                kvAnnotations.push(item);
                nextId = Math.max(nextId, item.id + 1);
            }
            // 구 형식: ETC
            else if (item.type && item.type.startsWith('etc') && item.bbox) {
                kvAnnotations.push({
                    id: nextId++,
                    type: 'etc',
                    bbox: item.bbox,
                    text: item.text || null
                });
            }
            // 구 형식: Key-Value 쌍
            else if (item.key && item.key.bbox) {
                const keyId = nextId++;
                kvAnnotations.push({
                    id: keyId,
                    type: 'key',
                    bbox: item.key.bbox,
                    text: item.key.text || null
                });
                
                if (Array.isArray(item.values)) {
                    item.values.forEach((val) => {
                        if (val.bbox) {
                            kvAnnotations.push({
                                id: nextId++,
                                type: 'value',
                                key_id: keyId,
                                bbox: val.bbox,
                                text: val.text || null
                            });
                        }
                    });
                }
            }
        });
        
        kvNextId = nextId;
    } else {
        alert('유효하지 않은 JSON 형식입니다.');
        return;
    }
    
    // 상태 초기화
    kvMode = 'key';
    kvCurrentKeyId = null;
    
    // UI 업데이트
    updateKvModeIndicator();
    renderKvLabels();
    drawAnnotationsOnCanvas();
}

// ============================================
// Save Annotations
// ============================================

function saveKvAnnotations() {
    if (kvAnnotations.length === 0) {
        alert('저장할 어노테이션이 없습니다.');
        return;
    }
    
    // 새로운 JSON 구조
    const outputData = {
        image: kvCurrentImage ? kvCurrentImage.filename : 'unknown.jpg',
        width: kvCurrentImage ? kvCurrentImage.width : 0,
        height: kvCurrentImage ? kvCurrentImage.height : 0,
        annotations: kvAnnotations
    };
    
    // JSON 문자열 생성
    const jsonStr = JSON.stringify(outputData, null, 2);
    
    // Blob 생성 및 다운로드
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // 파일명 생성 (원본 이미지 이름 기반)
    const baseName = kvCurrentImage ? kvCurrentImage.filename.replace(/\.[^/.]+$/, '') : 'annotations';
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    if (kvSaveInfo) {
        kvSaveInfo.textContent = '✅ 다운로드 완료!';
        setTimeout(() => {
            kvSaveInfo.textContent = '';
        }, 3000);
    }
}
