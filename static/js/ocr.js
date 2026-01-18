/**
 * OCR 텍스트 추출 - JavaScript
 */

// ============================================
// 상태 관리
// ============================================
let currentMode = 'single';
let selectedImageFile = null;
let extractedTextData = null;
let currentTaskId = null;
let progressInterval = null;

// Pan & Zoom 상태
let currentZoom = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let originalImageData = null;

// ============================================
// DOM 요소 참조
// ============================================
const elements = {
    // 모드 탭
    modeTabs: document.querySelectorAll('.mode-tab'),
    singleModeSection: document.getElementById('singleModeSection'),
    batchModeSection: document.getElementById('batchModeSection'),
    
    // 단일 모드
    imageArea: document.getElementById('imageArea'),
    imageInput: document.getElementById('imageInput'),
    imagePreview: document.getElementById('imagePreview'),
    previewImg: document.getElementById('previewImg'),
    removeImage: document.getElementById('removeImage'),
    imageInfo: document.getElementById('imageInfo'),
    // 대용량 모드
    batchFolderPath: document.getElementById('batchFolderPath'),
    outputFolderPath: document.getElementById('outputFolderPath'),
    
    // 버튼
    extractBtn: document.getElementById('extractBtn'),
    batchExtractBtn: document.getElementById('batchExtractBtn'),
    copyTextBtn: document.getElementById('copyTextBtn'),
    downloadTextBtn: document.getElementById('downloadTextBtn'),
    downloadJsonBtn: document.getElementById('downloadJsonBtn'),
    
    // 진행 상황
    progressSection: document.getElementById('progressSection'),
    progressTitle: document.getElementById('progressTitle'),
    progressFill: document.getElementById('progressFill'),
    progressCurrent: document.getElementById('progressCurrent'),
    progressTotal: document.getElementById('progressTotal'),
    progressPercent: document.getElementById('progressPercent'),
    
    // 결과 - 단일
    singleResultSection: document.getElementById('singleResultSection'),
    resultImage: document.getElementById('resultImage'),
    ocrResultCanvas: document.getElementById('ocrResultCanvas'),
    ocrCanvasContainer: document.getElementById('ocrCanvasContainer'),
    ocrCanvasWrapper: document.getElementById('ocrCanvasWrapper'),
    zoomIndicator: document.getElementById('zoomIndicator'),
    extractedText: document.getElementById('extractedText'),
    charCount: document.getElementById('charCount'),
    wordCount: document.getElementById('wordCount'),
    lineCount: document.getElementById('lineCount'),
    boxCount: document.getElementById('boxCount'),
    avgConfidence: document.getElementById('avgConfidence'),
    downloadImageBtn: document.getElementById('downloadImageBtn'),
    
    // 결과 - 대용량
    batchResultSection: document.getElementById('batchResultSection'),
    batchTotalCount: document.getElementById('batchTotalCount'),
    batchSuccessCount: document.getElementById('batchSuccessCount'),
    batchErrorCount: document.getElementById('batchErrorCount'),
    batchResultsList: document.getElementById('batchResultsList')
};

// ============================================
// 초기화
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initModeTabs();
    initImageUpload();
    initButtons();
    updateExtractButton();
});

// ============================================
// 모드 탭
// ============================================
function initModeTabs() {
    elements.modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            switchMode(mode);
        });
    });
}

function switchMode(mode) {
    currentMode = mode;
    
    // 탭 활성화 상태 업데이트
    elements.modeTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    
    // 섹션 표시/숨김
    elements.singleModeSection.hidden = mode !== 'single';
    elements.batchModeSection.hidden = mode !== 'batch';
    
    // 결과 섹션 숨김
    elements.singleResultSection.hidden = true;
    elements.batchResultSection.hidden = true;
    
    updateExtractButton();
}

// ============================================
// 이미지 업로드 (단일 모드)
// ============================================
function initImageUpload() {
    // 클릭으로 파일 선택
    elements.imageArea.addEventListener('click', (e) => {
        if (!e.target.closest('.remove-btn')) {
            elements.imageInput.click();
        }
    });
    
    // 파일 선택 핸들러
    elements.imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleImageFile(file);
    });
    
    // 드래그 앤 드롭
    elements.imageArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.imageArea.classList.add('drag-over');
    });
    
    elements.imageArea.addEventListener('dragleave', () => {
        elements.imageArea.classList.remove('drag-over');
    });
    
    elements.imageArea.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.imageArea.classList.remove('drag-over');
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageFile(file);
        }
    });
    
    // 이미지 삭제
    elements.removeImage.addEventListener('click', (e) => {
        e.stopPropagation();
        clearImage();
    });
}

function handleImageFile(file) {
    selectedImageFile = file;
    
    // 프리뷰 표시
    const reader = new FileReader();
    reader.onload = (e) => {
        elements.previewImg.src = e.target.result;
        elements.imagePreview.hidden = false;
        elements.imageArea.querySelector('.upload-content').hidden = true;
    };
    reader.readAsDataURL(file);
    
    // 파일 정보 표시
    const fileSize = (file.size / 1024).toFixed(1) + ' KB';
    elements.imageInfo.textContent = `${file.name} (${fileSize})`;
    
    updateExtractButton();
}

function clearImage() {
    selectedImageFile = null;
    elements.imageInput.value = '';
    elements.previewImg.src = '';
    elements.imagePreview.hidden = true;
    elements.imageArea.querySelector('.upload-content').hidden = false;
    elements.imageInfo.textContent = '';
    updateExtractButton();
}

// ============================================
// 버튼 초기화
// ============================================
function initButtons() {
    elements.extractBtn?.addEventListener('click', extractSingle);
    elements.batchExtractBtn?.addEventListener('click', extractBatch);
    elements.copyTextBtn?.addEventListener('click', copyText);
    elements.downloadTextBtn?.addEventListener('click', downloadText);
    elements.downloadJsonBtn?.addEventListener('click', downloadJson);
    elements.downloadImageBtn?.addEventListener('click', downloadResultImage);
    
    // Pan & Zoom 이벤트 초기화
    initPanZoom();
    
    // 대용량 모드 경로 입력 감지
    elements.batchFolderPath?.addEventListener('input', updateBatchButton);
    elements.outputFolderPath?.addEventListener('input', updateBatchButton);
}

// ============================================
// Pan & Zoom 기능
// ============================================
function initPanZoom() {
    const container = elements.ocrCanvasContainer;
    if (!container) return;
    
    // 마우스 휠 - 줌
    container.addEventListener('wheel', handleWheel, { passive: false });
    
    // 마우스 드래그 - 패닝
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseUp);
    
    // 더블클릭 - 리셋
    container.addEventListener('dblclick', resetPanZoom);
    
    // 터치 지원
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
}

function handleWheel(e) {
    e.preventDefault();
    
    const container = elements.ocrCanvasContainer;
    const wrapper = elements.ocrCanvasWrapper;
    if (!container || !wrapper || !originalImageData) return;
    
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // 줌 계산
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 10);
    
    // 마우스 위치를 기준으로 줌
    const zoomRatio = newZoom / currentZoom;
    panX = mouseX - (mouseX - panX) * zoomRatio;
    panY = mouseY - (mouseY - panY) * zoomRatio;
    
    currentZoom = newZoom;
    updateCanvasTransform();
    updateZoomIndicator();
}

function handleMouseDown(e) {
    if (e.button !== 0) return; // 왼쪽 클릭만
    isDragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    elements.ocrCanvasContainer.style.cursor = 'grabbing';
}

function handleMouseMove(e) {
    if (!isDragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
    updateCanvasTransform();
}

function handleMouseUp() {
    isDragging = false;
    if (elements.ocrCanvasContainer) {
        elements.ocrCanvasContainer.style.cursor = 'grab';
    }
}

// 터치 이벤트
let lastTouchDistance = 0;
let lastTouchX = 0;
let lastTouchY = 0;

function handleTouchStart(e) {
    if (e.touches.length === 1) {
        isDragging = true;
        dragStartX = e.touches[0].clientX - panX;
        dragStartY = e.touches[0].clientY - panY;
    } else if (e.touches.length === 2) {
        isDragging = false;
        lastTouchDistance = getTouchDistance(e.touches);
        const center = getTouchCenter(e.touches);
        lastTouchX = center.x;
        lastTouchY = center.y;
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    
    if (e.touches.length === 1 && isDragging) {
        panX = e.touches[0].clientX - dragStartX;
        panY = e.touches[0].clientY - dragStartY;
        updateCanvasTransform();
    } else if (e.touches.length === 2) {
        const distance = getTouchDistance(e.touches);
        const center = getTouchCenter(e.touches);
        
        // 핀치 줌
        const zoomFactor = distance / lastTouchDistance;
        const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 10);
        
        const rect = elements.ocrCanvasContainer.getBoundingClientRect();
        const centerX = center.x - rect.left;
        const centerY = center.y - rect.top;
        
        const zoomRatio = newZoom / currentZoom;
        panX = centerX - (centerX - panX) * zoomRatio;
        panY = centerY - (centerY - panY) * zoomRatio;
        
        currentZoom = newZoom;
        lastTouchDistance = distance;
        
        updateCanvasTransform();
        updateZoomIndicator();
    }
}

function handleTouchEnd() {
    isDragging = false;
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(touches) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    };
}

function updateCanvasTransform() {
    const wrapper = elements.ocrCanvasWrapper;
    if (!wrapper) return;
    wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
}

function updateZoomIndicator() {
    if (elements.zoomIndicator) {
        elements.zoomIndicator.textContent = Math.round(currentZoom * 100) + '%';
    }
}

function resetPanZoom() {
    if (!originalImageData || !elements.ocrCanvasContainer) return;
    
    const container = elements.ocrCanvasContainer;
    const canvas = elements.ocrResultCanvas;
    
    // 이미지를 컨테이너에 맞게 초기 위치 및 줌 설정
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    // 초기 줌 50%로 설정
    currentZoom = 0.5;
    
    // 중앙 정렬
    panX = (containerWidth - canvasWidth * currentZoom) / 2;
    panY = (containerHeight - canvasHeight * currentZoom) / 2;
    
    updateCanvasTransform();
    updateZoomIndicator();
}

function updateExtractButton() {
    const canExtract = selectedImageFile !== null;
    if (elements.extractBtn) {
        elements.extractBtn.disabled = !canExtract;
    }
}

function updateBatchButton() {
    const folderPath = elements.batchFolderPath?.value.trim();
    const outputPath = elements.outputFolderPath?.value.trim();
    const canExtract = folderPath && outputPath;
    if (elements.batchExtractBtn) {
        elements.batchExtractBtn.disabled = !canExtract;
    }
}

// ============================================
// 텍스트 추출
// ============================================
async function extractSingle() {
    if (!selectedImageFile) return;
    
    const engine = 'paddleocr';
    
    // 버튼 상태 변경
    elements.extractBtn.disabled = true;
    elements.extractBtn.innerHTML = '<span class="spinner"></span> 추출 중...';
    
    try {
        const formData = new FormData();
        formData.append('image', selectedImageFile);
        formData.append('engine', engine);
        
        const response = await fetch('/ocr/extract', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || '텍스트 추출에 실패했습니다.');
        }
        
        // 결과 저장
        extractedTextData = result;
        
        // 결과 표시
        displaySingleResult(result);
        
    } catch (error) {
        alert('오류: ' + error.message);
    } finally {
        elements.extractBtn.disabled = false;
        elements.extractBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2"/>
                <path d="M14 2V8H20" stroke="currentColor" stroke-width="2"/>
                <path d="M9 15H15M9 11H15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            📝 텍스트 추출
        `;
        updateExtractButton();
    }
}

function displaySingleResult(result) {
    // 이미지 로드 후 Canvas에 그리기
    const img = new Image();
    img.onload = () => {
        originalImageData = {
            image: img,
            boxes: result.boxes || []
        };
        
        // Canvas에 OCR 결과 그리기 (원본 크기)
        drawOCRResult(img, result.boxes || []);
        
        // Pan & Zoom 초기화 (컨테이너에 맞게)
        setTimeout(() => resetPanZoom(), 50);
    };
    img.src = elements.previewImg.src;
    elements.resultImage.src = elements.previewImg.src;
    
    // 추출된 텍스트
    elements.extractedText.textContent = result.text || '텍스트를 찾을 수 없습니다.';
    
    // 통계
    elements.charCount.textContent = result.stats?.charCount || 0;
    elements.wordCount.textContent = result.stats?.wordCount || 0;
    elements.lineCount.textContent = result.stats?.lineCount || 0;
    elements.boxCount.textContent = result.stats?.boxCount || 0;
    elements.avgConfidence.textContent = ((result.stats?.avgConfidence || 0) * 100).toFixed(1) + '%';
    
    // 결과 섹션 표시
    elements.singleResultSection.hidden = false;
    
    // 결과로 스크롤
    elements.singleResultSection.scrollIntoView({ behavior: 'smooth' });
}

// ============================================
// Canvas에 OCR 결과 그리기
// ============================================
function drawOCRResult(img, boxes) {
    const canvas = elements.ocrResultCanvas;
    const ctx = canvas.getContext('2d');
    
    // Canvas 크기 설정 (원본 크기)
    canvas.width = img.width;
    canvas.height = img.height;
    
    // 이미지 그리기
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    // 박스와 텍스트 그리기
    boxes.forEach((box, index) => {
        const bbox = box.bbox;
        if (!bbox) return;
        
        // 색상 설정 (신뢰도에 따라 색상 변경)
        const confidence = box.confidence || 0;
        let color;
        if (confidence >= 0.9) {
            color = '#10b981'; // 녹색 (높은 신뢰도)
        } else if (confidence >= 0.7) {
            color = '#f59e0b'; // 주황색 (중간 신뢰도)
        } else {
            color = '#ef4444'; // 빨간색 (낮은 신뢰도)
        }
        
        // 박스 좌표 계산
        let x, y, width, height;
        
        if (Array.isArray(bbox) && bbox.length === 4) {
            // [x_min, y_min, x_max, y_max] 형식
            if (typeof bbox[0] === 'number') {
                x = bbox[0];
                y = bbox[1];
                width = bbox[2] - bbox[0];
                height = bbox[3] - bbox[1];
            } else if (Array.isArray(bbox[0])) {
                // [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] 폴리곤 형식
                const minX = Math.min(bbox[0][0], bbox[1][0], bbox[2][0], bbox[3][0]);
                const minY = Math.min(bbox[0][1], bbox[1][1], bbox[2][1], bbox[3][1]);
                const maxX = Math.max(bbox[0][0], bbox[1][0], bbox[2][0], bbox[3][0]);
                const maxY = Math.max(bbox[0][1], bbox[1][1], bbox[2][1], bbox[3][1]);
                x = minX;
                y = minY;
                width = maxX - minX;
                height = maxY - minY;
            }
        } else {
            return; // 알 수 없는 형식
        }
        
        // 반투명 배경 그리기
        ctx.fillStyle = color + '20'; // 알파 추가
        ctx.fillRect(x, y, width, height);
        
        // 박스 테두리 그리기
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        
        // 텍스트 배경 그리기
        const text = box.text || '';
        const fontSize = 14;
        ctx.font = `bold ${fontSize}px 'Noto Sans KR', sans-serif`;
        const textMetrics = ctx.measureText(text);
        const textHeight = fontSize + 6;
        const textY = y + height + 2; // 박스 아래에 텍스트
        
        // 텍스트가 Canvas 밖으로 나가면 박스 위에 표시
        const finalTextY = (textY + textHeight > canvas.height) ? y - textHeight : textY;
        
        // 텍스트 배경
        ctx.fillStyle = color + 'E0';
        ctx.fillRect(x, finalTextY, textMetrics.width + 8, textHeight);
        
        // 텍스트 그리기
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, x + 4, finalTextY + fontSize);
    });
}

function downloadResultImage() {
    const canvas = elements.ocrResultCanvas;
    if (!canvas) return;
    
    const filename = selectedImageFile ? 
        selectedImageFile.name.replace(/\.[^/.]+$/, '_ocr.png') : 
        'ocr_result.png';
    
    canvas.toBlob(blob => {
        downloadBlob(blob, filename);
    }, 'image/png');
}

// ============================================
// 대용량 처리
// ============================================
async function extractBatch() {
    const folderPath = elements.batchFolderPath.value.trim();
    const outputPath = elements.outputFolderPath.value.trim();
    const engine = 'paddleocr';
    
    if (!folderPath || !outputPath) return;
    
    // 버튼 상태 변경
    elements.batchExtractBtn.disabled = true;
    elements.batchExtractBtn.innerHTML = '<span class="spinner"></span> 시작 중...';
    
    try {
        const response = await fetch('/ocr/batch/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folderPath: folderPath,
                outputFolder: outputPath,
                engine: engine
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || '배치 처리 시작에 실패했습니다.');
        }
        
        currentTaskId = result.taskId;
        
        // 진행 상황 모니터링 시작
        elements.progressSection.hidden = false;
        startProgressPolling();
        
    } catch (error) {
        alert('오류: ' + error.message);
        resetBatchUI();
    }
}

function startProgressPolling() {
    progressInterval = setInterval(async () => {
        try {
            const response = await fetch(`/ocr/batch/progress/${currentTaskId}`);
            const task = await response.json();
            
            if (!response.ok) {
                throw new Error(task.error || '진행 상황 조회 실패');
            }
            
            // 진행 상황 업데이트
            updateProgress(task);
            
            if (task.status === 'completed' || task.status === 'error') {
                stopProgressPolling();
                
                if (task.status === 'completed') {
                    displayBatchResult(task);
                } else {
                    alert('오류: ' + (task.error || '처리 중 오류가 발생했습니다.'));
                }
                
                resetBatchUI();
            }
            
        } catch (error) {
            console.error('Progress polling error:', error);
        }
    }, 500);
}

function stopProgressPolling() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

function updateProgress(task) {
    elements.progressCurrent.textContent = task.current || 0;
    elements.progressTotal.textContent = task.total || 0;
    elements.progressPercent.textContent = task.percent || 0;
    elements.progressFill.style.width = `${task.percent || 0}%`;
    elements.progressTitle.textContent = `OCR 처리 중... (${task.current}/${task.total})`;
}

function displayBatchResult(task) {
    const results = task.results || [];
    const errors = task.errors || [];
    
    // 통계 업데이트
    elements.batchTotalCount.textContent = results.length + errors.length;
    elements.batchSuccessCount.textContent = results.length;
    elements.batchErrorCount.textContent = errors.length;
    
    // 결과 목록 생성
    elements.batchResultsList.innerHTML = '';
    
    // 성공 항목
    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'batch-result-item success';
        div.innerHTML = `
            <span class="filename">${item.filename}</span>
            <span class="char-count">${item.charCount}자</span>
        `;
        elements.batchResultsList.appendChild(div);
    });
    
    // 오류 항목
    errors.forEach(item => {
        const div = document.createElement('div');
        div.className = 'batch-result-item error';
        div.innerHTML = `
            <span class="filename">${item.filename}</span>
            <span class="char-count" style="color: var(--error-color);">${item.error}</span>
        `;
        elements.batchResultsList.appendChild(div);
    });
    
    // 결과 섹션 표시
    elements.batchResultSection.hidden = false;
    elements.progressSection.hidden = true;
    
    // 결과로 스크롤
    elements.batchResultSection.scrollIntoView({ behavior: 'smooth' });
}

function resetBatchUI() {
    elements.batchExtractBtn.disabled = false;
    elements.batchExtractBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2"/>
            <path d="M14 2V8H20" stroke="currentColor" stroke-width="2"/>
            <path d="M9 15H15M9 11H15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        📝 대용량 텍스트 추출
    `;
    updateBatchButton();
}

// ============================================
// 결과 다운로드
// ============================================
function copyText() {
    if (!extractedTextData?.text) return;
    
    navigator.clipboard.writeText(extractedTextData.text)
        .then(() => {
            elements.copyTextBtn.textContent = '✅ 복사됨!';
            setTimeout(() => {
                elements.copyTextBtn.textContent = '📋 텍스트 복사';
            }, 2000);
        })
        .catch(err => {
            alert('클립보드 복사 실패: ' + err.message);
        });
}

function downloadText() {
    if (!extractedTextData?.text) return;
    
    const filename = selectedImageFile ? 
        selectedImageFile.name.replace(/\.[^/.]+$/, '.txt') : 
        'ocr_result.txt';
    
    const blob = new Blob([extractedTextData.text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, filename);
}

function downloadJson() {
    if (!extractedTextData) return;
    
    const filename = selectedImageFile ? 
        selectedImageFile.name.replace(/\.[^/.]+$/, '.json') : 
        'ocr_result.json';
    
    // [{"bbox": [...], "text": "..."}] 형식으로 변환
    const jsonData = (extractedTextData.boxes || []).map(box => ({
        bbox: box.bbox || [],
        text: box.text || ''
    }));
    
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { 
        type: 'application/json;charset=utf-8' 
    });
    downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
