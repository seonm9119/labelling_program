/**
 * Key-Value 자동 맵핑 JavaScript
 * OCR 라벨과 어노테이션 bbox를 매칭하여 텍스트 자동 채우기
 */

(function() {
    'use strict';

    // ============================================
    // 상태 관리
    // ============================================
    const state = {
        image: null,
        imageFile: null,
        annotationData: null,
        labelData: null,      // 물류 OCR 데이터
        paddleData: null,     // PaddleOCR 데이터
        result: null,
        zoom: 100,
        // OCR 이미지 크기 (좌표 스케일링용)
        ocrImageWidth: null,
        ocrImageHeight: null,
        // 편집 상태
        selectedId: null,
        isDragging: false,
        isResizing: false,
        isDrawing: false,  // 새 bbox 그리기 모드
        resizeHandle: null,
        dragStartX: 0,
        dragStartY: 0,
        originalBbox: null,
        drawStartX: 0,
        drawStartY: 0
    };

    // 리사이즈 핸들 크기
    const HANDLE_SIZE = 8;

    // ============================================
    // DOM 요소
    // ============================================
    const elements = {
        // 업로드 영역
        imageUploadArea: document.getElementById('imageUploadArea'),
        imageInput: document.getElementById('imageInput'),
        imagePreview: document.getElementById('imagePreview'),
        previewImg: document.getElementById('previewImg'),
        removeImage: document.getElementById('removeImage'),
        imageStatus: document.getElementById('imageStatus'),
        imageInfo: document.getElementById('imageInfo'),

        annotationUploadArea: document.getElementById('annotationUploadArea'),
        annotationInput: document.getElementById('annotationInput'),
        annotationStatus: document.getElementById('annotationStatus'),
        annotationInfo: document.getElementById('annotationInfo'),

        labelUploadArea: document.getElementById('labelUploadArea'),
        labelInput: document.getElementById('labelInput'),
        labelStatus: document.getElementById('labelStatus'),
        labelInfo: document.getElementById('labelInfo'),

        // PaddleOCR 업로드
        paddleUploadArea: document.getElementById('paddleUploadArea'),
        paddleInput: document.getElementById('paddleInput'),
        paddleStatus: document.getElementById('paddleStatus'),
        paddleInfo: document.getElementById('paddleInfo'),

        // 옵션
        overlapThreshold: document.getElementById('overlapThreshold'),
        overlapValue: document.getElementById('overlapValue'),
        bboxExpand: document.getElementById('bboxExpand'),
        expandValue: document.getElementById('expandValue'),
        textSeparator: document.getElementById('textSeparator'),

        // 버튼
        runMappingBtn: document.getElementById('runMappingBtn'),
        resetBtn: document.getElementById('resetBtn'),
        downloadManualResultBtn: document.getElementById('downloadManualResultBtn'),
        downloadAutoResultBtn: document.getElementById('downloadAutoResultBtn'),

        // 결과 영역
        resultSection: document.getElementById('resultSection'),
        totalAnnotations: document.getElementById('totalAnnotations'),
        mappedCount: document.getElementById('mappedCount'),
        emptyCount: document.getElementById('emptyCount'),
        resultTableBody: document.getElementById('resultTableBody'),

        // 시각화
        visualizationArea: document.getElementById('visualizationArea'),
        visImage: document.getElementById('visImage'),
        visCanvas: document.getElementById('visCanvas'),
        editCanvas: document.getElementById('editCanvas'),
        visCanvasContainer: document.getElementById('visCanvasContainer'),
        visCanvasWrapper: document.getElementById('visCanvasWrapper'),
        visZoomIn: document.getElementById('visZoomIn'),
        visZoomOut: document.getElementById('visZoomOut'),
        visZoomReset: document.getElementById('visZoomReset'),
        visZoomLevel: document.getElementById('visZoomLevel'),
        showPaddleOcr: document.getElementById('showPaddleOcr'),
        showLogisticsOcr: document.getElementById('showLogisticsOcr'),
        showAnnotation: document.getElementById('showAnnotation'),
        showResult: document.getElementById('showResult'),

        // 편집 패널
        editPanel: document.getElementById('editPanel'),
        editPanelClose: document.getElementById('editPanelClose'),
        editType: document.getElementById('editType'),
        editKeyIdField: document.getElementById('editKeyIdField'),
        editKeyId: document.getElementById('editKeyId'),
        editText: document.getElementById('editText'),
        applyEditBtn: document.getElementById('applyEditBtn'),
        cancelEditBtn: document.getElementById('cancelEditBtn')
    };

    // ============================================
    // 초기화
    // ============================================
    function init() {
        console.log('[초기화] 시작');
        console.log('[초기화] elements:', elements);
        setupEventListeners();
        updateButtonState();
        console.log('[초기화] 완료');
    }

    function setupEventListeners() {
        console.log('[이벤트리스너] 설정 시작');
        
        // 이미지 업로드
        if (elements.imageUploadArea) {
            elements.imageUploadArea.addEventListener('click', () => elements.imageInput.click());
            console.log('[이벤트리스너] 이미지 업로드 영역 클릭 이벤트 등록');
        }
        elements.imageInput.addEventListener('change', handleImageUpload);
        elements.removeImage.addEventListener('click', (e) => {
            e.stopPropagation();
            clearImage();
        });
        setupDragDrop(elements.imageUploadArea, elements.imageInput);

        // 어노테이션 JSON 업로드
        elements.annotationUploadArea.addEventListener('click', () => elements.annotationInput.click());
        elements.annotationInput.addEventListener('change', handleAnnotationUpload);
        setupDragDrop(elements.annotationUploadArea, elements.annotationInput);

        // 물류 OCR 라벨 JSON 업로드
        elements.labelUploadArea.addEventListener('click', () => elements.labelInput.click());
        elements.labelInput.addEventListener('change', handleLabelUpload);
        setupDragDrop(elements.labelUploadArea, elements.labelInput);

        // PaddleOCR JSON 업로드
        if (elements.paddleUploadArea && elements.paddleInput) {
            elements.paddleUploadArea.addEventListener('click', () => elements.paddleInput.click());
            elements.paddleInput.addEventListener('change', handlePaddleUpload);
            setupDragDrop(elements.paddleUploadArea, elements.paddleInput);
        }

        // 옵션 (제거된 요소는 무시)
        elements.overlapThreshold?.addEventListener('input', () => {
            if (elements.overlapValue) {
                elements.overlapValue.textContent = elements.overlapThreshold.value + '%';
            }
        });
        
        elements.bboxExpand?.addEventListener('input', () => {
            if (elements.expandValue) {
                elements.expandValue.textContent = elements.bboxExpand.value + 'px';
            }
        });

        // 버튼
        elements.runMappingBtn.addEventListener('click', runAutoMapping);
        elements.resetBtn.addEventListener('click', resetAll);
        elements.downloadManualResultBtn.addEventListener('click', downloadManualResult);
        elements.downloadAutoResultBtn.addEventListener('click', downloadAutoResult);

        // 시각화 컨트롤
        elements.visZoomIn.addEventListener('click', () => adjustZoom(10));
        elements.visZoomOut.addEventListener('click', () => adjustZoom(-10));
        elements.visZoomReset.addEventListener('click', () => setZoom(100));
        // 체크박스 변경 시 - 자동맵핑 결과 선택하면 다른 것들 해제
        elements.showPaddleOcr?.addEventListener('change', () => {
            if (elements.showPaddleOcr.checked && elements.showResult) {
                elements.showResult.checked = false;
            }
            redrawCanvas();
        });
        elements.showLogisticsOcr?.addEventListener('change', () => {
            if (elements.showLogisticsOcr.checked && elements.showResult) {
                elements.showResult.checked = false;
            }
            redrawCanvas();
        });
        elements.showAnnotation?.addEventListener('change', () => {
            if (elements.showAnnotation.checked && elements.showResult) {
                elements.showResult.checked = false;
            }
            redrawCanvas();
        });
        elements.showResult?.addEventListener('change', () => {
            // 자동맵핑 결과 선택 시 다른 체크박스 모두 해제
            if (elements.showResult.checked) {
                if (elements.showPaddleOcr) elements.showPaddleOcr.checked = false;
                if (elements.showLogisticsOcr) elements.showLogisticsOcr.checked = false;
                if (elements.showAnnotation) elements.showAnnotation.checked = false;
            }
            redrawCanvas();
        });

        // 마우스 휠 줌
        elements.visCanvasWrapper?.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                adjustZoom(e.deltaY > 0 ? -10 : 10);
            }
        });

        // 편집 캔버스 이벤트
        elements.editCanvas?.addEventListener('mousedown', handleEditMouseDown);
        elements.editCanvas?.addEventListener('mousemove', handleEditMouseMove);
        elements.editCanvas?.addEventListener('mouseup', handleEditMouseUp);
        elements.editCanvas?.addEventListener('mouseleave', handleEditMouseUp);
        elements.editCanvas?.addEventListener('dblclick', handleEditDoubleClick);

        // 편집 패널 이벤트
        elements.editPanelClose?.addEventListener('click', closeEditPanel);
        elements.applyEditBtn?.addEventListener('click', applyEdit);
        elements.cancelEditBtn?.addEventListener('click', closeEditPanel);

        // key_id 입력 필드에 숫자만 허용
        elements.editKeyId?.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });

        // ESC로 선택 해제
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && state.selectedId !== null) {
                deselectAnnotation();
            }
        });
    }

    function setupDragDrop(area, input) {
        area.addEventListener('dragover', (e) => {
            e.preventDefault();
            area.classList.add('drag-over');
        });

        area.addEventListener('dragleave', () => {
            area.classList.remove('drag-over');
        });

        area.addEventListener('drop', (e) => {
            e.preventDefault();
            area.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const dt = new DataTransfer();
                dt.items.add(files[0]);
                input.files = dt.files;
                input.dispatchEvent(new Event('change'));
            }
        });
    }

    // ============================================
    // 파일 업로드 핸들러
    // ============================================
    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('이미지 파일만 업로드 가능합니다.');
            return;
        }

        state.imageFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
            state.image = event.target.result;
            elements.previewImg.src = state.image;
            elements.imagePreview.hidden = false;
            elements.imageUploadArea.querySelector('.upload-placeholder').hidden = true;
            elements.imageStatus.textContent = '업로드됨';
            elements.imageStatus.classList.add('uploaded');
            elements.imageInfo.textContent = file.name;
            document.getElementById('imageUploadCard').classList.add('uploaded');
            updateButtonState();
        };
        reader.readAsDataURL(file);
    }

    function clearImage() {
        state.image = null;
        state.imageFile = null;
        elements.imageInput.value = '';
        elements.imagePreview.hidden = true;
        elements.imageUploadArea.querySelector('.upload-placeholder').hidden = false;
        elements.imageStatus.textContent = '미업로드';
        elements.imageStatus.classList.remove('uploaded');
        elements.imageInfo.textContent = '';
        document.getElementById('imageUploadCard').classList.remove('uploaded');
        updateButtonState();
    }

    function handleAnnotationUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (!data.annotations || !Array.isArray(data.annotations)) {
                    alert('올바른 어노테이션 JSON 형식이 아닙니다.\n"annotations" 배열이 필요합니다.');
                    return;
                }
                state.annotationData = data;
                elements.annotationStatus.textContent = '업로드됨';
                elements.annotationStatus.classList.add('uploaded');
                elements.annotationInfo.textContent = `${file.name} (${data.annotations.length}개 항목)`;
                document.getElementById('annotationUploadCard').classList.add('uploaded');
                updateButtonState();
            } catch (err) {
                alert('JSON 파싱 오류: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function handleLabelUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                // 다양한 OCR 라벨 형식 지원
                const words = extractWordsFromLabel(data);
                if (!words || words.length === 0) {
                    alert('OCR 라벨에서 텍스트를 찾을 수 없습니다.\n지원 형식: words, texts, results 배열');
                    return;
                }
                state.labelData = { words, original: data };
                elements.labelStatus.textContent = '업로드됨';
                elements.labelStatus.classList.add('uploaded');
                elements.labelInfo.textContent = `${file.name} (${words.length}개 텍스트)`;
                document.getElementById('labelUploadCard').classList.add('uploaded');
                updateButtonState();
            } catch (err) {
                alert('JSON 파싱 오류: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function handlePaddleUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                // PaddleOCR 형식 파싱
                const words = extractWordsFromPaddle(data);
                if (!words || words.length === 0) {
                    alert('PaddleOCR JSON에서 텍스트를 찾을 수 없습니다.\n형식: [{text, bbox}] 배열');
                    return;
                }
                state.paddleData = { words, original: data };
                elements.paddleStatus.textContent = '업로드됨';
                elements.paddleStatus.classList.add('uploaded');
                elements.paddleInfo.textContent = `${file.name} (${words.length}개 텍스트)`;
                document.getElementById('paddleUploadCard').classList.add('uploaded');
                updateButtonState();
            } catch (err) {
                alert('JSON 파싱 오류: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    /**
     * PaddleOCR 형식에서 words 배열 추출
     */
    function extractWordsFromPaddle(data) {
        let words = [];

        // 배열 형식: [{text, bbox}, ...]
        if (Array.isArray(data)) {
            words = data;
        }
        // 객체 형식: {results: [...]} 또는 {words: [...]}
        else if (data.results && Array.isArray(data.results)) {
            words = data.results;
        }
        else if (data.words && Array.isArray(data.words)) {
            words = data.words;
        }

        // bbox 정규화
        return words.map(w => {
            let bbox = w.bbox || w.box || w.bounding_box;
            
            // PaddleOCR 4-point polygon 형식 변환: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            if (bbox && Array.isArray(bbox) && bbox.length === 4 && Array.isArray(bbox[0])) {
                const xs = bbox.map(p => p[0]);
                const ys = bbox.map(p => p[1]);
                bbox = [
                    Math.min(...xs),
                    Math.min(...ys),
                    Math.max(...xs),
                    Math.max(...ys)
                ];
            }

            return {
                text: w.text || w.transcription || w.label || '',
                bbox: bbox
            };
        }).filter(w => w.bbox && w.text);
    }

    /**
     * 다양한 OCR 라벨 형식에서 words 배열 추출
     */
    function extractWordsFromLabel(data) {
        let words = [];

        // 형식 1: { bbox: [...] } with x, y arrays (물류 OCR 데이터셋 형식)
        if (data.bbox && Array.isArray(data.bbox) && data.bbox.length > 0 && data.bbox[0].x) {
            // 이미지 크기 정보 저장 (Images 객체에서)
            if (data.Images) {
                state.ocrImageWidth = data.Images.width;
                state.ocrImageHeight = data.Images.height;
                console.log('[OCR] 이미지 크기:', data.Images.width, 'x', data.Images.height);
            } else {
                console.warn('[OCR] Images 정보 없음!');
            }
            
            words = data.bbox.map((item, idx) => {
                // x, y 배열은 4개의 꼭지점 좌표
                const xs = item.x;
                const ys = item.y;
                
                // 4개의 점에서 bbox 추출 (min/max)
                const x1 = Math.min(...xs);
                const y1 = Math.min(...ys);
                const x2 = Math.max(...xs);
                const y2 = Math.max(...ys);
                
                // 처음 3개만 로그 출력
                if (idx < 3) {
                    console.log(`[OCR bbox ${idx}] x=${JSON.stringify(xs)}, y=${JSON.stringify(ys)} → [${x1}, ${y1}, ${x2}, ${y2}]`);
                }
                
                return {
                    text: item.data || '',
                    bbox: [x1, y1, x2, y2]
                };
            });
            
            console.log('[OCR] 총', words.length, '개 텍스트 로드됨');
        }
        // 형식 2: { words: [...] }
        else if (data.words && Array.isArray(data.words)) {
            words = data.words;
        }
        // 형식 3: { texts: [...] }
        else if (data.texts && Array.isArray(data.texts)) {
            words = data.texts;
        }
        // 형식 4: { results: [...] }
        else if (data.results && Array.isArray(data.results)) {
            words = data.results;
        }
        // 형식 5: 배열 자체
        else if (Array.isArray(data)) {
            words = data;
        }
        // 형식 6: { shapes: [...] } (labelme 형식)
        else if (data.shapes && Array.isArray(data.shapes)) {
            words = data.shapes.map(shape => ({
                text: shape.label,
                points: shape.points
            }));
        }

        // 이미 변환된 경우 (물류 OCR 형식) 바로 반환
        if (words.length > 0 && words[0].bbox && Array.isArray(words[0].bbox)) {
            return words.filter(w => w.bbox && w.text);
        }

        // bbox 정규화
        return words.map(w => {
            let bbox = w.bbox || w.box || w.bounding_box;
            
            // points 형식을 bbox로 변환 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            if (!bbox && w.points && Array.isArray(w.points)) {
                const xs = w.points.map(p => p[0]);
                const ys = w.points.map(p => p[1]);
                bbox = [
                    Math.min(...xs),
                    Math.min(...ys),
                    Math.max(...xs),
                    Math.max(...ys)
                ];
            }
            
            // PaddleOCR 4-point polygon 형식 변환: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            if (bbox && Array.isArray(bbox) && bbox.length === 4 && Array.isArray(bbox[0])) {
                const xs = bbox.map(p => p[0]);
                const ys = bbox.map(p => p[1]);
                bbox = [
                    Math.min(...xs),
                    Math.min(...ys),
                    Math.max(...xs),
                    Math.max(...ys)
                ];
            }

            return {
                text: w.text || w.transcription || w.label || w.data || '',
                bbox: bbox
            };
        }).filter(w => w.bbox && w.text);
    }

    // ============================================
    // 상태 관리
    // ============================================
    function updateButtonState() {
        // 어노테이션 + PaddleOCR + 물류OCR 모두 있어야 실행 가능
        const canRun = state.annotationData && state.paddleData && state.labelData;
        elements.runMappingBtn.disabled = !canRun;
    }

    function resetAll() {
        // 상태 초기화
        state.image = null;
        state.imageFile = null;
        state.annotationData = null;
        state.labelData = null;
        state.paddleData = null;
        state.result = null;
        state.zoom = 100;
        state.ocrImageWidth = null;
        state.ocrImageHeight = null;

        // 이미지 초기화
        clearImage();

        // 어노테이션 초기화
        elements.annotationInput.value = '';
        elements.annotationStatus.textContent = '미업로드';
        elements.annotationStatus.classList.remove('uploaded');
        elements.annotationInfo.textContent = '';
        document.getElementById('annotationUploadCard').classList.remove('uploaded');

        // 물류 OCR 라벨 초기화
        elements.labelInput.value = '';
        elements.labelStatus.textContent = '미업로드';
        elements.labelStatus.classList.remove('uploaded');
        elements.labelInfo.textContent = '';
        document.getElementById('labelUploadCard').classList.remove('uploaded');

        // PaddleOCR 초기화
        if (elements.paddleInput) {
            elements.paddleInput.value = '';
            elements.paddleStatus.textContent = '미업로드';
            elements.paddleStatus.classList.remove('uploaded');
            elements.paddleInfo.textContent = '';
            document.getElementById('paddleUploadCard')?.classList.remove('uploaded');
        }

        // 결과 영역 숨기기
        elements.resultSection.hidden = true;

        updateButtonState();
    }

    // ============================================
    // 자동 맵핑 로직
    // ============================================
    function runAutoMapping() {
        // 어노테이션 + PaddleOCR + 물류OCR 필요
        if (!state.annotationData || !state.paddleData || !state.labelData) {
            alert('어노테이션 JSON, PaddleOCR JSON, 물류OCR JSON을 모두 업로드해주세요.');
            return;
        }

        const separator = elements.textSeparator.value === '\\n' ? '\n' : elements.textSeparator.value;

        const annotations = JSON.parse(JSON.stringify(state.annotationData.annotations)); // 깊은 복사
        
        // PaddleOCR만 사용 (물류 OCR은 시각화용으로만 유지)
        const paddleWords = state.paddleData?.words || [];
        
        let mappedCount = 0;
        let emptyCount = 0;

        // bbox가 근처인지 확인하는 함수 (수동맵핑 bbox 근처 또는 포함)
        const isBboxNearby = (annBbox, ocrBbox, margin = 50) => {
            // OCR bbox가 수동맵핑 bbox에 포함되는지
            const ocrCenterX = (ocrBbox[0] + ocrBbox[2]) / 2;
            const ocrCenterY = (ocrBbox[1] + ocrBbox[3]) / 2;
            const inAnn = ocrCenterX >= annBbox[0] - margin && ocrCenterX <= annBbox[2] + margin &&
                          ocrCenterY >= annBbox[1] - margin && ocrCenterY <= annBbox[3] + margin;

            // 수동맵핑 bbox 중심이 OCR bbox 근처인지
            const annCenterX = (annBbox[0] + annBbox[2]) / 2;
            const annCenterY = (annBbox[1] + annBbox[3]) / 2;
            const nearOcr = annCenterX >= ocrBbox[0] - margin && annCenterX <= ocrBbox[2] + margin &&
                            annCenterY >= ocrBbox[1] - margin && annCenterY <= ocrBbox[3] + margin;
            
            return inAnn || nearOcr;
        };

        // 수동맵핑 annotations는 모두 제외 (VALUE만 물류 OCR에서 생성)
        annotations.forEach(ann => {
            ann.bbox = null;
            ann._noMatch = true;
        });

        // VALUE 생성: 물류 OCR을 가로로 스페이스 간격 정도로 합침
        const logisticsWords = state.labelData?.words || [];
        const valueAnnotations = [];
        let valueIdCounter = 1000;
        
        if (logisticsWords.length > 0) {
            // 평균 bbox 높이 계산 → 스페이스 간격 기준
            const avgHeight = logisticsWords.reduce((sum, w) => sum + (w.bbox[3] - w.bbox[1]), 0) / logisticsWords.length;
            const spaceGap = avgHeight;  // 스페이스 간격 ≈ 높이
            
            // X 기준 정렬 (같은 줄이면 왼쪽→오른쪽)
            const sortedWords = [...logisticsWords].sort((a, b) => {
                const yMid1 = (a.bbox[1] + a.bbox[3]) / 2;
                const yMid2 = (b.bbox[1] + b.bbox[3]) / 2;
                if (Math.abs(yMid1 - yMid2) > avgHeight * 0.5) return yMid1 - yMid2;
                return a.bbox[0] - b.bbox[0];
            });
            
            // 같은 줄인지 확인
            const isSameLine = (bbox1, bbox2) => {
                const y1Mid = (bbox1[1] + bbox1[3]) / 2;
                const y2Mid = (bbox2[1] + bbox2[3]) / 2;
                return Math.abs(y1Mid - y2Mid) < avgHeight * 0.5;
            };
            
            // 가로로 합치기
            const used = new Set();
            
            for (let i = 0; i < sortedWords.length; i++) {
                if (used.has(i)) continue;
                
                const cluster = [sortedWords[i]];
                used.add(i);
                
                // 오른쪽으로 연속된 단어 찾기
                let lastWord = sortedWords[i];
                for (let j = i + 1; j < sortedWords.length; j++) {
                    if (used.has(j)) continue;
                    
                    const currWord = sortedWords[j];
                    
                    // 같은 줄인지
                    if (!isSameLine(lastWord.bbox, currWord.bbox)) continue;
                    
                    // 가로 간격 계산
                    const xGap = currWord.bbox[0] - lastWord.bbox[2];
                    
                    // 스페이스 간격 이하면 합침
                    if (xGap >= 0 && xGap <= spaceGap) {
                        cluster.push(currWord);
                        used.add(j);
                        lastWord = currWord;
                    }
                }
                
                // X 기준 정렬
                cluster.sort((a, b) => a.bbox[0] - b.bbox[0]);
                
                // bbox 합치기
                const mergedBbox = [
                    Math.min(...cluster.map(w => w.bbox[0])),
                    Math.min(...cluster.map(w => w.bbox[1])),
                    Math.max(...cluster.map(w => w.bbox[2])),
                    Math.max(...cluster.map(w => w.bbox[3]))
                ];
                
                // text 합치기
                const mergedText = cluster.map(w => w.text).join(' ');
                
                valueAnnotations.push({
                    id: valueIdCounter++,
                    type: 'value',
                    bbox: mergedBbox,
                    text: mergedText,
                    keyId: null,
                    _autoGenerated: true,
                    _wordCount: cluster.length
                });
            }
            
        }
                
        // KEY 생성: PaddleOCR 중에서 VALUE bbox와 겹치지 않는 것들
        const keyAnnotations = [];
        let keyIdCounter = 2000;
        
        if (paddleWords.length > 0) {
            // 두 bbox의 겹침 비율 계산 (작은 bbox 기준)
            const getOverlapRatio = (bbox1, bbox2) => {
                const ix1 = Math.max(bbox1[0], bbox2[0]);
                const iy1 = Math.max(bbox1[1], bbox2[1]);
                const ix2 = Math.min(bbox1[2], bbox2[2]);
                const iy2 = Math.min(bbox1[3], bbox2[3]);
                
                if (ix2 <= ix1 || iy2 <= iy1) return 0;
                
                const intersectionArea = (ix2 - ix1) * (iy2 - iy1);
                const area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1]);
                const area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1]);
                const smallerArea = Math.min(area1, area2);
                
                return smallerArea > 0 ? intersectionArea / smallerArea : 0;
            };
            
            let skippedCount = 0;
            paddleWords.forEach(paddleWord => {
                // VALUE bbox들과 80% 이상 겹치는지 확인
                const overlapsWithValue = valueAnnotations.some(value => 
                    getOverlapRatio(paddleWord.bbox, value.bbox) >= 0.8
                );
                
                // VALUE와 80% 이상 겹치지 않으면 KEY로 추가
                if (!overlapsWithValue) {
                    keyAnnotations.push({
                        id: keyIdCounter++,
                        type: 'key',
                        bbox: [...paddleWord.bbox],
                        text: paddleWord.text,
                        _autoGenerated: true
                    });
                } else {
                    skippedCount++;
                }
            });
            
            console.log(`[KEY 생성] PaddleOCR ${paddleWords.length}개 중 VALUE와 80%+ 겹침: ${skippedCount}개 제외, KEY: ${keyAnnotations.length}개`);
        }
        
        console.log(`[KEY 생성 완료] ${keyAnnotations.length}개`);
                
        // 수동맵핑을 두 번 이동: 1) KEY 기준 2) VALUE 기준
        console.log('========== 수동맵핑 이동 (KEY + VALUE 기준) ==========');
        
        const manualKeys = state.annotationData.annotations.filter(ann => ann.type === 'key' && ann.bbox);
        const manualValues = state.annotationData.annotations.filter(ann => ann.type === 'value' && ann.bbox);
        const manualEtcs = state.annotationData.annotations.filter(ann => ann.type === 'etc' && ann.bbox);
        
        // 이동된 좌표를 저장할 맵 (id → 이동된 bbox)
        const movedBboxMap = new Map();
        const totalDeltaMap = new Map();  // 누적 이동량
        
        // 초기값 설정
        manualKeys.forEach(k => {
            movedBboxMap.set(k.id, [...k.bbox]);
            totalDeltaMap.set(k.id, [0, 0]);
        });
        manualValues.forEach(v => {
            movedBboxMap.set(v.id, [...v.bbox]);
            totalDeltaMap.set(v.id, [0, 0]);
        });
        manualEtcs.forEach(e => {
            movedBboxMap.set(e.id, [...e.bbox]);
            totalDeltaMap.set(e.id, [0, 0]);
        });
                
        // 이미 이동된 ETC 추적
        const movedEtcIds = new Set();
        
        // 두 bbox의 좌상단(x1, y1) 사이 거리
        const getDistance = (bbox1, bbox2) => {
            return Math.sqrt(Math.pow(bbox1[0] - bbox2[0], 2) + Math.pow(bbox1[1] - bbox2[1], 2));
        };
        
        // ========== KEY 기준 이동 (자동맵핑 결과 참조) ==========
        console.log('--- KEY 기준 이동 (자동맵핑 KEY 참조) ---');
        const usedAutoKeys = new Set();
        const movedKeyBboxes = [];  // 이미 이동된 KEY bbox들 저장
        
        // 두 bbox가 겹치는지 확인 (크기 상관없이)
        const hasOverlapWithMargin = (bbox1, bbox2) => {
            const margin = 30;  // 약간의 여유
            const ix1 = Math.max(bbox1[0] - margin, bbox2[0] - margin);
            const iy1 = Math.max(bbox1[1] - margin, bbox2[1] - margin);
            const ix2 = Math.min(bbox1[2] + margin, bbox2[2] + margin);
            const iy2 = Math.min(bbox1[3] + margin, bbox2[3] + margin);
            return ix2 > ix1 && iy2 > iy1;
        };
        
        // 두 bbox가 겹치는지 확인 (마진 없이)
        const bboxOverlaps = (bbox1, bbox2) => {
            const ix1 = Math.max(bbox1[0], bbox2[0]);
            const iy1 = Math.max(bbox1[1], bbox2[1]);
            const ix2 = Math.min(bbox1[2], bbox2[2]);
            const iy2 = Math.min(bbox1[3], bbox2[3]);
            return ix2 > ix1 && iy2 > iy1;
        };
        
        // Levenshtein 거리 계산 (편집 거리)
        const levenshteinDistance = (str1, str2) => {
            const m = str1.length, n = str2.length;
            const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
            for (let i = 0; i <= m; i++) dp[i][0] = i;
            for (let j = 0; j <= n; j++) dp[0][j] = j;
            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    if (str1[i-1] === str2[j-1]) dp[i][j] = dp[i-1][j-1];
                    else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
                }
            }
            return dp[m][n];
        };
        
        // 텍스트 유사도 체크 함수
        const textContainsSingle = (manualLine, paddleText) => {
            if (!manualLine || !paddleText) return false;
            const manualNoSpace = manualLine.trim().replace(/\s+/g, '');
            const paddleNoSpace = paddleText.replace(/\s+/g, '');
            
            // 완전 일치
            if (paddleNoSpace === manualNoSpace) return true;
            
            // 수동맵핑에 특수문자가 있는지 확인
            const hasSpecialChar = /[^a-zA-Z0-9]/.test(manualNoSpace);
            
            if (hasSpecialChar) {
                // 수동맵핑에 특수문자가 있으면 → 정확히 포함되어야 함
                return paddleNoSpace.includes(manualNoSpace);
            } else {
                // 수동맵핑에 특수문자가 없으면 → PaddleOCR에서 알파벳/숫자만 추출해서 비교
                // 예: 수동맵핑 "Class" → PaddleOCR "Class:8" ✅
                const paddleAlphaOnly = paddleNoSpace.replace(/[^a-zA-Z0-9]/g, '');
                
                // 포함 관계 체크
                if (paddleAlphaOnly.includes(manualNoSpace) || manualNoSpace.includes(paddleAlphaOnly)) {
                    return true;
                }
                
                // 유사도 체크 (80% 이상, 철자 오류 허용)
                const dist = levenshteinDistance(manualNoSpace, paddleAlphaOnly);
                const maxLen = Math.max(manualNoSpace.length, paddleAlphaOnly.length);
                const similarity = 1 - (dist / maxLen);
                
                return similarity >= 0.8;
            }
        };
        
        console.log(`[수동맵핑 KEY] ${manualKeys.length}개 처리`);
        
        // 단순 로직: 텍스트 유사 후보 중 가장 왼쪽 상단으로 이동
        manualKeys.forEach(manualKey => {
            const currentBbox = movedBboxMap.get(manualKey.id);
            
            // 수동맵핑 text를 \n으로 분리 (여러 줄일 수 있음)
            const manualLines = (manualKey.text || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
            console.log(`[KEY] "${manualKey.text}" → ${manualLines.length}개 라인으로 분리`);
            
            // 1. 각 라인에 대해 텍스트로 유사한 후보 검출
            const candidates = [];
            paddleWords.forEach((pw, idx) => {
                // 수동맵핑의 어떤 라인이라도 매칭되면 후보에 추가
                const isMatch = manualLines.some(line => textContainsSingle(line, pw.text));
                if (isMatch) {
                    candidates.push({ ...pw, idx });
                }
            });
            
            console.log(`[KEY] "${manualKey.text}" → 후보 ${candidates.length}개`);
            
            if (candidates.length === 0) {
                console.log(`[KEY 매칭 실패] "${manualKey.text}" → 유사한 텍스트 없음`);
                return;
            }
            
            // 2. 가장 왼쪽 상단 bbox 선택 (x + y 가 가장 작은 것)
            candidates.sort((a, b) => {
                const scoreA = a.bbox[0] + a.bbox[1];
                const scoreB = b.bbox[0] + b.bbox[1];
                return scoreA - scoreB;
            });
            const matched = candidates[0];
            
            const deltaX = matched.bbox[0] - currentBbox[0];
            const deltaY = matched.bbox[1] - currentBbox[1];
            
            console.log(`[KEY 매칭] "${manualKey.text}" → "${matched.text}" (위치: ${matched.bbox[0]}, ${matched.bbox[1]})`);
            
            // 3. KEY bbox 좌표 이동 (크기 유지)
            const newKeyBbox = [
                matched.bbox[0],
                matched.bbox[1],
                matched.bbox[0] + (currentBbox[2] - currentBbox[0]),
                matched.bbox[1] + (currentBbox[3] - currentBbox[1])
            ];
            movedBboxMap.set(manualKey.id, newKeyBbox);
            totalDeltaMap.set(manualKey.id, [deltaX, deltaY]);
            
            // 연결된 VALUE도 같이 이동
            const linkedValues = manualValues.filter(v => v.key_id === manualKey.id);
            linkedValues.forEach(manualValue => {
                const valBbox = movedBboxMap.get(manualValue.id);
                movedBboxMap.set(manualValue.id, [
                    valBbox[0] + deltaX,
                    valBbox[1] + deltaY,
                    valBbox[2] + deltaX,
                    valBbox[3] + deltaY
                ]);
                totalDeltaMap.set(manualValue.id, [deltaX, deltaY]);
            });
            
            // KEY에서 가장 가까운 ETC도 같이 이동 (아직 이동 안 된 것만)
            });
            
        // ========== 2단계: VALUE 기준 매칭 (1단계 실패한 KEY들) ==========
        console.log('--- 2단계: VALUE 기준 매칭 ---');
        const stage2MatchedKeyIds = new Set();
        
        // 1단계에서 이미 이동된 KEY들과 그 연결된 VALUE들 수집
        const stage1MatchedKeyIds = new Set();
        const stage1MovedValueIds = new Set();
        manualKeys.forEach(mk => {
            const delta = totalDeltaMap.get(mk.id);
            if (delta[0] !== 0 || delta[1] !== 0) {
                stage1MatchedKeyIds.add(mk.id);
                // 연결된 VALUE들도 1단계에서 이동된 것으로 표시
                manualValues.filter(v => v.key_id === mk.id).forEach(v => {
                    stage1MovedValueIds.add(v.id);
                });
            }
        });
        
        console.log(`[2단계] 1단계에서 이동된 KEY: ${stage1MatchedKeyIds.size}개, VALUE: ${stage1MovedValueIds.size}개, ETC: ${movedEtcIds.size}개`);
        
        manualKeys.forEach(manualKey => {
            // 이미 1단계에서 매칭된 KEY는 스킵
            if (stage1MatchedKeyIds.has(manualKey.id)) return;
            
            // 연결된 VALUE들 찾기 (1단계에서 이동된 VALUE는 제외)
            const linkedValues = manualValues.filter(v => v.key_id === manualKey.id && !stage1MovedValueIds.has(v.id));
            if (linkedValues.length === 0) {
                console.log(`[2단계] KEY "${manualKey.text}" → VALUE 없음 또는 이미 이동됨, 스킵`);
                return;
            }
            
            // 각 VALUE에 대해 자동맵핑 VALUE와 매칭 시도
            for (const manualValue of linkedValues) {
                const manualValBbox = movedBboxMap.get(manualValue.id);
                
                // 자동맵핑 VALUE 중 수동맵핑 VALUE에 포함되거나 근사한 것 찾기
                let bestAutoValue = null;
                let bestScore = Infinity;
                
                for (const autoVal of valueAnnotations) {
                    // 자동맵핑 VALUE가 수동맵핑 VALUE에 완전히 포함되는지 확인
                    const isContained = autoVal.bbox[0] >= manualValBbox[0] - 30 && 
                                        autoVal.bbox[1] >= manualValBbox[1] - 30 && 
                                        autoVal.bbox[2] <= manualValBbox[2] + 30 && 
                                        autoVal.bbox[3] <= manualValBbox[3] + 30;
                    
                    // 또는 위치가 아주 근사한지 확인 (좌상단 거리 50px 이내)
                    const dist = Math.sqrt(
                        Math.pow(autoVal.bbox[0] - manualValBbox[0], 2) +
                        Math.pow(autoVal.bbox[1] - manualValBbox[1], 2)
                    );
                    const isNearby = dist < 50;
                    
                    if (isContained || isNearby) {
                        // 좌상단 기준 점수 (작을수록 좋음)
                        const score = autoVal.bbox[0] + autoVal.bbox[1];
                        if (score < bestScore) {
                            bestScore = score;
                            bestAutoValue = autoVal;
                        }
                    }
                }
                
                if (bestAutoValue) {
                    // VALUE 이동량 계산
                    const deltaX = bestAutoValue.bbox[0] - manualValBbox[0];
                    const deltaY = bestAutoValue.bbox[1] - manualValBbox[1];
                    
                    console.log(`[2단계 매칭] KEY "${manualKey.text}" → VALUE 기준 이동 (delta: ${deltaX.toFixed(0)}, ${deltaY.toFixed(0)})`);
                    
                    // KEY 이동 (1차: VALUE 기준)
                    const keyBbox = movedBboxMap.get(manualKey.id);
                    let movedKeyBbox = [
                        keyBbox[0] + deltaX,
                        keyBbox[1] + deltaY,
                        keyBbox[2] + deltaX,
                        keyBbox[3] + deltaY
                    ];
                    
                    // KEY 미세 조정: 이동된 KEY 근처의 PaddleOCR bbox 찾기
                    let closestPaddle = null;
                    let minPaddleDist = 50;  // 50px 이내만 고려
                    
                    paddleWords.forEach(pw => {
                        const dist = Math.sqrt(
                            Math.pow(pw.bbox[0] - movedKeyBbox[0], 2) +
                            Math.pow(pw.bbox[1] - movedKeyBbox[1], 2)
                        );
                        if (dist < minPaddleDist) {
                            minPaddleDist = dist;
                            closestPaddle = pw;
                        }
                    });
                    
                    let finalDeltaX = deltaX;
                    let finalDeltaY = deltaY;
                    
                    if (closestPaddle) {
                        // KEY를 PaddleOCR 왼쪽 상단으로 미세 조정
                        const keyWidth = movedKeyBbox[2] - movedKeyBbox[0];
                        const keyHeight = movedKeyBbox[3] - movedKeyBbox[1];
                        movedKeyBbox = [
                            closestPaddle.bbox[0],
                            closestPaddle.bbox[1],
                            closestPaddle.bbox[0] + keyWidth,
                            closestPaddle.bbox[1] + keyHeight
                        ];
                        finalDeltaX = closestPaddle.bbox[0] - keyBbox[0];
                        finalDeltaY = closestPaddle.bbox[1] - keyBbox[1];
                        console.log(`  → KEY를 PaddleOCR "${closestPaddle.text}" 기준으로 미세 조정 (거리: ${minPaddleDist.toFixed(0)}px)`);
                    }
                    
                    movedBboxMap.set(manualKey.id, movedKeyBbox);
                    totalDeltaMap.set(manualKey.id, [finalDeltaX, finalDeltaY]);
                    
                    // 연결된 모든 VALUE 이동 (KEY의 최종 delta 사용)
                    linkedValues.forEach(lv => {
                        const lvBbox = movedBboxMap.get(lv.id);
                        movedBboxMap.set(lv.id, [
                            lvBbox[0] + finalDeltaX,
                            lvBbox[1] + finalDeltaY,
                            lvBbox[2] + finalDeltaX,
                            lvBbox[3] + finalDeltaY
                        ]);
                        totalDeltaMap.set(lv.id, [finalDeltaX, finalDeltaY]);
                    });
                    
                    stage2MatchedKeyIds.add(manualKey.id);
                    break;  // 하나 매칭되면 종료
                }
            }
            
            if (!stage2MatchedKeyIds.has(manualKey.id)) {
                console.log(`[2단계 실패] KEY "${manualKey.text}" → 매칭되는 자동맵핑 VALUE 없음`);
            }
        });
        
        console.log(`[2단계 완료] ${stage2MatchedKeyIds.size}개 KEY 추가 매칭`);
        
        // ========== 3단계: 2단계 매칭된 것들 PaddleOCR 기준 미세 조정 ==========
        console.log('--- 3단계: 2단계 매칭된 것들 PaddleOCR 미세 조정 ---');
        
        // 2단계에서 매칭된 KEY들 미세 조정
        stage2MatchedKeyIds.forEach(keyId => {
            const manualKey = manualKeys.find(k => k.id === keyId);
            if (!manualKey) return;
            
            const currentBbox = movedBboxMap.get(keyId);
            const keyFirstChar = (manualKey.text || '').trim().charAt(0);
            
            // 현재 bbox에 걸쳐진 PaddleOCR 찾기
            const overlappingPaddles = [];
            paddleWords.forEach(pw => {
                const isOverlap = !(pw.bbox[2] < currentBbox[0] || 
                                   pw.bbox[0] > currentBbox[2] || 
                                   pw.bbox[3] < currentBbox[1] || 
                                   pw.bbox[1] > currentBbox[3]);
                
                if (isOverlap) {
                    const paddleFirstChar = (pw.text || '').trim().charAt(0);
                    if (keyFirstChar && paddleFirstChar && keyFirstChar === paddleFirstChar) {
                        overlappingPaddles.push(pw);
                    }
                }
            });
            
            if (overlappingPaddles.length > 0) {
                // 가장 왼쪽 상단 PaddleOCR 선택
                overlappingPaddles.sort((a, b) => (a.bbox[0] + a.bbox[1]) - (b.bbox[0] + b.bbox[1]));
                const targetPaddle = overlappingPaddles[0];
                
                const keyWidth = currentBbox[2] - currentBbox[0];
                const keyHeight = currentBbox[3] - currentBbox[1];
                const newBbox = [
                    targetPaddle.bbox[0],
                    targetPaddle.bbox[1],
                    targetPaddle.bbox[0] + keyWidth,
                    targetPaddle.bbox[1] + keyHeight
                ];
                
                const extraDeltaX = targetPaddle.bbox[0] - currentBbox[0];
                const extraDeltaY = targetPaddle.bbox[1] - currentBbox[1];
                
                movedBboxMap.set(keyId, newBbox);
                const prevDelta = totalDeltaMap.get(keyId);
                totalDeltaMap.set(keyId, [prevDelta[0] + extraDeltaX, prevDelta[1] + extraDeltaY]);
                
                // 연결된 VALUE도 같이 이동
                const linkedValues = manualValues.filter(v => v.key_id === keyId);
                linkedValues.forEach(lv => {
                    const lvBbox = movedBboxMap.get(lv.id);
                    movedBboxMap.set(lv.id, [
                        lvBbox[0] + extraDeltaX,
                        lvBbox[1] + extraDeltaY,
                        lvBbox[2] + extraDeltaX,
                        lvBbox[3] + extraDeltaY
                    ]);
                    const lvPrevDelta = totalDeltaMap.get(lv.id);
                    totalDeltaMap.set(lv.id, [lvPrevDelta[0] + extraDeltaX, lvPrevDelta[1] + extraDeltaY]);
                });
                
                console.log(`[3단계 KEY] "${manualKey.text}" → PaddleOCR "${targetPaddle.text}" 기준 미세 조정 (VALUE ${linkedValues.length}개 같이 이동)`);
            }
        });
        
        console.log(`[3단계 완료]`);
        
        // ========== ETC 독립 처리: PaddleOCR bbox 기준 좌표 이동 ==========
        console.log('--- ETC 독립 처리 (PaddleOCR 기준) ---');
        
        // ETC용 텍스트 매칭 함수 (대소문자 무시, 공백 제거 비교 추가)
        const matchEtcText = (etcText, paddleText) => {
            if (!etcText || !paddleText) return false;
            
            // 1. 공백/특수문자 제거한 문자열로 시작 부분 비교 (BILLOF LADING vs BILL OF LADING 처리)
            const etcNormalized = etcText.toLowerCase().replace(/[\s\n\/\-\:\,\.]+/g, '');
            const paddleNormalized = paddleText.toLowerCase().replace(/[\s\n\/\-\:\,\.]+/g, '');
            
            // ETC 시작 부분이 PaddleOCR에 포함되거나, PaddleOCR이 ETC로 시작하면 매칭
            if (paddleNormalized.startsWith(etcNormalized.substring(0, Math.min(10, etcNormalized.length))) ||
                etcNormalized.startsWith(paddleNormalized.substring(0, Math.min(10, paddleNormalized.length)))) {
                console.log(`    [공백무시 매칭] "${etcText.substring(0,20)}" ≈ "${paddleText.substring(0,20)}"`);
                return true;
            }
            
            // 2. 단어 분리 비교 (기존 로직)
            const etcWords = etcText.trim().split(/[\s\n\/\-\:\,\.]+/).filter(w => w.length > 0);
            const paddleWords_split = paddleText.trim().split(/[\s\n\/\-\:\,\.]+/).filter(w => w.length > 0);
            
            if (etcWords.length === 0 || paddleWords_split.length === 0) return false;
            
            // 최대 3개 단어까지 비교
            const maxWords = Math.min(3, etcWords.length, paddleWords_split.length);
            let matchedCount = 0;
            
            for (let i = 0; i < maxWords; i++) {
                const etcWord = etcWords[i].toLowerCase();
                const paddleWord = paddleWords_split[i].toLowerCase();
                
                // 정확히 일치 체크
                if (etcWord === paddleWord) {
                    matchedCount++;
                } else {
                    // Levenshtein으로 철자 오류 체크
                    const dist = levenshteinDistance(etcWord, paddleWord);
                    const maxDist = etcWord.length <= 3 ? 1 : 2;
                    
                    if (dist <= maxDist) {
                        matchedCount++;
                    } else {
                        break;
                    }
                }
            }
            
            const minRequired = etcWords.length === 1 ? 1 : 2;
            return matchedCount >= minRequired;
        };
        
        // PaddleOCR bbox가 이동된 KEY/VALUE bbox 안에 있는지 확인하는 함수
        // (KEY/VALUE는 이미 좌표 이동 완료된 상태)
        const isInsideMovedKeyValue = (pwBbox) => {
            // 이동된 KEY bbox 안에 있는지 확인
            for (const key of manualKeys) {
                const keyBbox = movedBboxMap.get(key.id);
                if (!keyBbox) continue;
                
                // PaddleOCR 중심점이 KEY bbox 안에 있는지 확인
                const pwCenterX = (pwBbox[0] + pwBbox[2]) / 2;
                const pwCenterY = (pwBbox[1] + pwBbox[3]) / 2;
                
                if (pwCenterX >= keyBbox[0] && pwCenterX <= keyBbox[2] &&
                    pwCenterY >= keyBbox[1] && pwCenterY <= keyBbox[3]) {
                    return { isInside: true, type: 'KEY', text: key.text?.substring(0, 20) };
                }
            }
            // 이동된 VALUE bbox 안에 있는지 확인
            for (const value of manualValues) {
                const valueBbox = movedBboxMap.get(value.id);
                if (!valueBbox) continue;
                
                const pwCenterX = (pwBbox[0] + pwBbox[2]) / 2;
                const pwCenterY = (pwBbox[1] + pwBbox[3]) / 2;
                
                if (pwCenterX >= valueBbox[0] && pwCenterX <= valueBbox[2] &&
                    pwCenterY >= valueBbox[1] && pwCenterY <= valueBbox[3]) {
                    return { isInside: true, type: 'VALUE', text: value.text?.substring(0, 20) };
                }
            }
            return { isInside: false };
        };
        
        manualEtcs.forEach(etc => {
            // 원래 ETC bbox 사용 (수동맵핑 원본)
            const etcBbox = [...etc.bbox];
            const etcWords = (etc.text || '').trim().split(/[\s\n\/\-\:\,\.]+/).filter(w => w.length > 0);
            const etcFirstWord = etcWords[0] || '';
            
            console.log(`[ETC 검색] "${etc.text?.substring(0, 30) || ''}..." 첫 단어: "${etcFirstWord}", bbox: [${etcBbox.join(', ')}]`);
            
            // ETC bbox에 포함되거나 걸쳐지는 PaddleOCR 찾기
            const overlappingPaddles = [];
            paddleWords.forEach(pw => {
                // 이동된 KEY/VALUE bbox 안에 있는 PaddleOCR은 제외
                const kvCheck = isInsideMovedKeyValue(pw.bbox);
                if (kvCheck.isInside) {
                    // 텍스트 매칭되는데 제외된 경우만 로그
                    if (etcFirstWord && matchEtcText(etc.text, pw.text)) {
                        console.log(`  [제외] PaddleOCR "${pw.text}" → ${kvCheck.type} "${kvCheck.text}" 영역 안에 위치`);
                    }
                    return;
                }
                
                // 포함 또는 겹침 확인
                const isOverlap = !(pw.bbox[2] < etcBbox[0] || 
                                   pw.bbox[0] > etcBbox[2] || 
                                   pw.bbox[3] < etcBbox[1] || 
                                   pw.bbox[1] > etcBbox[3]);
                
                if (isOverlap) {
                    // ETC용 텍스트 매칭 (대소문자 무시, 철자 오류 허용)
                    if (etcFirstWord && matchEtcText(etc.text, pw.text)) {
                        overlappingPaddles.push(pw);
                        console.log(`  [후보] PaddleOCR "${pw.text}" bbox: [${pw.bbox.join(', ')}]`);
                    }
                }
            });
            
            let targetPaddle = null;
            let matchType = '';
            
            if (overlappingPaddles.length > 0) {
                // 1차: bbox 겹침 + 텍스트 매칭 성공
                overlappingPaddles.sort((a, b) => (a.bbox[0] + a.bbox[1]) - (b.bbox[0] + b.bbox[1]));
                targetPaddle = overlappingPaddles[0];
                matchType = 'bbox겹침';
            } else {
                // 2차: bbox 겹침 없으면 전체 PaddleOCR에서 텍스트로만 매칭 (이동된 KEY/VALUE 영역 제외)
                const textOnlyMatches = paddleWords.filter(pw => {
                    const kvCheck = isInsideMovedKeyValue(pw.bbox);
                    if (kvCheck.isInside) {
                        if (etcFirstWord && matchEtcText(etc.text, pw.text)) {
                            console.log(`  [제외-텍스트전용] PaddleOCR "${pw.text}" → ${kvCheck.type} "${kvCheck.text}" 영역 안에 위치`);
                        }
                        return false;
                    }
                    return etcFirstWord && matchEtcText(etc.text, pw.text);
                });
                
                if (textOnlyMatches.length > 0) {
                    // 수동맵핑 ETC bbox 중심에서 가장 가까운 것 선택
                    const etcCenterX = (etcBbox[0] + etcBbox[2]) / 2;
                    const etcCenterY = (etcBbox[1] + etcBbox[3]) / 2;
                    textOnlyMatches.sort((a, b) => {
                        const distA = Math.sqrt(Math.pow((a.bbox[0] + a.bbox[2])/2 - etcCenterX, 2) + Math.pow((a.bbox[1] + a.bbox[3])/2 - etcCenterY, 2));
                        const distB = Math.sqrt(Math.pow((b.bbox[0] + b.bbox[2])/2 - etcCenterX, 2) + Math.pow((b.bbox[1] + b.bbox[3])/2 - etcCenterY, 2));
                        return distA - distB;
                    });
                    targetPaddle = textOnlyMatches[0];
                    matchType = `텍스트전용(${textOnlyMatches.length}개후보)`;
                }
            }
            
            if (targetPaddle) {
                const etcWidth = etcBbox[2] - etcBbox[0];
                const etcHeight = etcBbox[3] - etcBbox[1];
                const newBbox = [
                    targetPaddle.bbox[0],
                    targetPaddle.bbox[1],
                    targetPaddle.bbox[0] + etcWidth,
                    targetPaddle.bbox[1] + etcHeight
                ];
                
                const deltaX = targetPaddle.bbox[0] - etcBbox[0];
                const deltaY = targetPaddle.bbox[1] - etcBbox[1];
                
                movedBboxMap.set(etc.id, newBbox);
                totalDeltaMap.set(etc.id, [deltaX, deltaY]);
                movedEtcIds.add(etc.id);
                
                console.log(`[ETC 매칭] "${etc.text?.substring(0, 20) || ''}..." → PaddleOCR "${targetPaddle.text}" [${matchType}] (이동: ${deltaX}, ${deltaY})`);
            } else {
                console.log(`[ETC 매칭 실패] "${etc.text?.substring(0, 20) || ''}..." → 첫 단어 "${etcFirstWord}" 매칭되는 PaddleOCR 없음`);
            }
        });
        
        console.log(`[ETC 처리 완료] ${movedEtcIds.size}개 매칭`);
        
        // 최종 결과 생성 (매칭된 KEY와 그에 연결된 VALUE만 출력)
        const matchedManualAnnotations = [];
        const matchedKeyIds = new Set();
        
        manualKeys.forEach(manualKey => {
            const delta = totalDeltaMap.get(manualKey.id);
            const isMatched = delta[0] !== 0 || delta[1] !== 0;
            
            // 매칭된 KEY만 추가
            if (isMatched) {
                const movedBbox = movedBboxMap.get(manualKey.id);
                const stage = stage2MatchedKeyIds.has(manualKey.id) ? 2 : 1;
                matchedManualAnnotations.push({
                    ...manualKey,
                    bbox: movedBbox,
                    _movedFrom: [...manualKey.bbox],
                    _delta: delta,
                    _matched: true,
                    _stage: stage
                });
                matchedKeyIds.add(manualKey.id);
            }
        });
        
        manualValues.forEach(manualValue => {
            // 연결된 KEY가 매칭된 경우만 VALUE도 추가
            if (matchedKeyIds.has(manualValue.key_id)) {
                const movedBbox = movedBboxMap.get(manualValue.id);
                const delta = totalDeltaMap.get(manualValue.id);
                const stage = stage2MatchedKeyIds.has(manualValue.key_id) ? 2 : 1;
                matchedManualAnnotations.push({
                    ...manualValue,
                    bbox: movedBbox,
                    _movedFrom: [...manualValue.bbox],
                    _delta: delta,
                    _matched: true,
                    _stage: stage
                });
            }
        });
        
        // 이동된 ETC도 추가
        manualEtcs.forEach(manualEtc => {
            if (movedEtcIds.has(manualEtc.id)) {
                const movedBbox = movedBboxMap.get(manualEtc.id);
                const delta = totalDeltaMap.get(manualEtc.id);
                matchedManualAnnotations.push({
                    ...manualEtc,
                    bbox: movedBbox,
                    _movedFrom: [...manualEtc.bbox],
                    _delta: delta,
                    _matched: true
                });
            }
        });
        
        console.log(`[수동맵핑 매칭 완료] ${matchedKeyIds.size}개 KEY, ${movedEtcIds.size}개 ETC 매칭, 총 ${matchedManualAnnotations.length}개 출력`);
                
        // ========== 자동맵핑 결과 생성 (수동맵핑 기반) ==========
        console.log('========== 자동맵핑 결과 생성 ==========');
        const autoMappingResult = [];
        
        // 1. KEY: 수동맵핑 KEY bbox와 70% 이상 겹치는 PaddleOCR bbox 사용, text는 수동맵핑 값
        console.log(`[자동맵핑 KEY 시작] 수동맵핑 KEY ${manualKeys.length}개, PaddleOCR ${paddleWords.length}개`);
        manualKeys.forEach(manualKey => {
            // 이동된 bbox 사용 (원본이 아님!)
            const keyBbox = movedBboxMap.get(manualKey.id);
            if (!keyBbox) {
                console.log(`[자동맵핑 KEY] 스킵: "${manualKey.text}" → 이동된 bbox 없음`);
                return;
            }
            
            console.log(`[자동맵핑 KEY] 처리중: "${manualKey.text}" bbox=[${keyBbox.join(', ')}]`);
            
            // 수동맵핑 KEY bbox와 60% 이상 겹치는 PaddleOCR 찾기
            const overlappingPaddles = [];
            paddleWords.forEach(pw => {
                // IoU (Intersection over Union) 계산
                const x1 = Math.max(keyBbox[0], pw.bbox[0]);
                const y1 = Math.max(keyBbox[1], pw.bbox[1]);
                const x2 = Math.min(keyBbox[2], pw.bbox[2]);
                const y2 = Math.min(keyBbox[3], pw.bbox[3]);
                
                if (x2 > x1 && y2 > y1) {
                    const intersectionArea = (x2 - x1) * (y2 - y1);
                    const paddleArea = (pw.bbox[2] - pw.bbox[0]) * (pw.bbox[3] - pw.bbox[1]);
                    const keyArea = (keyBbox[2] - keyBbox[0]) * (keyBbox[3] - keyBbox[1]);
                    const unionArea = paddleArea + keyArea - intersectionArea;
                    
                    const iou = unionArea > 0 ? intersectionArea / unionArea : 0;
                    
                    if (iou >= 0.6) {
                        overlappingPaddles.push({ paddle: pw, iou: iou });
                    }
                }
            });
            
            if (overlappingPaddles.length > 0) {
                // IoU가 가장 높은 PaddleOCR bbox 사용
                overlappingPaddles.sort((a, b) => b.iou - a.iou);
                const bestMatch = overlappingPaddles[0];
                
                // PaddleOCR bbox 가져오기
                let finalBbox = [...bestMatch.paddle.bbox];
                
                // 가로(x)가 수동맵핑보다 크면 수동맵핑 범위로 자르기
                const paddleWidth = finalBbox[2] - finalBbox[0];
                const manualWidth = keyBbox[2] - keyBbox[0];
                
                if (paddleWidth > manualWidth) {
                    // x 좌표를 수동맵핑 범위로 제한
                    finalBbox[0] = Math.max(finalBbox[0], keyBbox[0]);
                    finalBbox[2] = Math.min(finalBbox[2], keyBbox[2]);
                    console.log(`  → 가로 범위 조정: PaddleOCR ${paddleWidth.toFixed(0)}px → ${(finalBbox[2] - finalBbox[0]).toFixed(0)}px (수동맵핑 기준)`);
                }
                
                autoMappingResult.push({
                    id: `auto_key_${manualKey.id}`,
                    type: 'key',
                    bbox: finalBbox,
                    text: manualKey.text,  // 수동맵핑 text 사용
                    key_id: manualKey.id,
                    _matchSuccess: true  // 매칭 성공 플래그
                });
                console.log(`  ✓ 매칭 성공: "${manualKey.text}" → bbox=[${finalBbox.join(', ')}] (IoU: ${(bestMatch.iou * 100).toFixed(1)}%)`);
            } else {
                // 매칭 실패 시 수동맵핑 bbox 그대로 사용
                autoMappingResult.push({
                    id: `auto_key_${manualKey.id}`,
                    type: 'key',
                    bbox: [...keyBbox],
                    text: manualKey.text,
                    key_id: manualKey.id,
                    _matchSuccess: false  // 매칭 실패 플래그
                });
                console.warn(`  ⚠ 매칭 실패: "${manualKey.text}" → 60% 이상 겹치는 PaddleOCR 없음`);
            }
        });
        
        // 2. VALUE: 수동맵핑 VALUE bbox와 70% 이상 겹치는 물류OCR bbox들을 합쳐서 사용, text는 물류OCR 값
        const logisticsWordsForAuto = state.labelData?.words || [];
        manualValues.forEach(manualValue => {
            // 이동된 bbox 사용
            const valBbox = movedBboxMap.get(manualValue.id);
            if (!valBbox) {
                console.warn(`⚠️ [자동맵핑 VALUE] key_id=${manualValue.key_id} → 이동된 bbox 없음`);
                return;
            }
            
            // 수동맵핑 VALUE bbox와 60% 이상 겹치는 물류OCR 찾기 (물류OCR bbox 기준)
            const overlappingLogistics = [];
            
            logisticsWordsForAuto.forEach(lw => {
                // 겹치는 영역 계산
                const x1 = Math.max(valBbox[0], lw.bbox[0]);
                const y1 = Math.max(valBbox[1], lw.bbox[1]);
                const x2 = Math.min(valBbox[2], lw.bbox[2]);
                const y2 = Math.min(valBbox[3], lw.bbox[3]);
                
                if (x2 > x1 && y2 > y1) {
                    const intersectionArea = (x2 - x1) * (y2 - y1);
                    const logisticsArea = (lw.bbox[2] - lw.bbox[0]) * (lw.bbox[3] - lw.bbox[1]);
                    
                    // 물류OCR bbox 기준으로 겹침 비율 계산
                    const overlapRatio = logisticsArea > 0 ? intersectionArea / logisticsArea : 0;
                    
                    if (overlapRatio >= 0.6) {
                        overlappingLogistics.push(lw);
                    }
                }
            });
            
            if (overlappingLogistics.length > 0) {
                // y 좌표 기준으로 정렬
                overlappingLogistics.sort((a, b) => a.bbox[1] - b.bbox[1]);
                
                // 평균 높이 계산
                const avgHeight = overlappingLogistics.reduce((sum, lw) => 
                    sum + (lw.bbox[3] - lw.bbox[1]), 0) / overlappingLogistics.length;
                
                // 줄간격 기준으로 그룹 분리 (평균 높이의 1.5배 이상이면 새로운 그룹)
                const lineGapThreshold = avgHeight * 1.5;
                const groups = [];
                let currentGroup = [overlappingLogistics[0]];
                
                for (let i = 1; i < overlappingLogistics.length; i++) {
                    const prev = overlappingLogistics[i - 1];
                    const curr = overlappingLogistics[i];
                    
                    // 이전 OCR의 하단과 현재 OCR의 상단 사이 간격
                    const gap = curr.bbox[1] - prev.bbox[3];
                    
                    if (gap > lineGapThreshold) {
                        // 간격이 크면 새로운 그룹 시작
                        groups.push(currentGroup);
                        currentGroup = [curr];
                    } else {
                        // 같은 그룹에 추가
                        currentGroup.push(curr);
                    }
                }
                groups.push(currentGroup); // 마지막 그룹 추가
                
                // 각 그룹을 별도의 VALUE로 생성
                groups.forEach((group, groupIdx) => {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    const texts = [];
                    
                    group.forEach(lw => {
                        minX = Math.min(minX, lw.bbox[0]);
                        minY = Math.min(minY, lw.bbox[1]);
                        maxX = Math.max(maxX, lw.bbox[2]);
                        maxY = Math.max(maxY, lw.bbox[3]);
                        texts.push(lw.text);
                    });
                    
                    const valueId = groups.length > 1 
                        ? `auto_value_${manualValue.id}_${groupIdx + 1}`  // value1, value2...
                        : `auto_value_${manualValue.id}`;
                    
                    autoMappingResult.push({
                        id: valueId,
                        type: 'value',
                        bbox: [minX, minY, maxX, maxY],
                        text: texts.join(' '),
                        key_id: manualValue.key_id,
                        value_order: groupIdx + 1  // 순서 추가
                    });
                });
                
                if (groups.length > 1) {
                    console.log(`  ✓ VALUE 매칭: key_id=${manualValue.key_id} → ${groups.length}개 그룹으로 분리 (줄간격 기준)`);
                } else {
                    console.log(`  ✓ VALUE 매칭: key_id=${manualValue.key_id} → 물류OCR ${overlappingLogistics.length}개 합침`);
                }
            } else {
                // 매칭 실패 시에도 VALUE 생성 (수동맵핑 값 사용)
                autoMappingResult.push({
                    id: `auto_value_${manualValue.id}`,
                    type: 'value',
                    bbox: [...valBbox],
                    text: manualValue.text || '',  // 수동맵핑 text 사용
                    key_id: manualValue.key_id,
                    value_order: 1  // 순서 추가
                });
                console.warn(`⚠️ [자동맵핑 VALUE] key_id=${manualValue.key_id} → 60% 이상 겹치는 물류OCR 없음, 수동맵핑 값 사용`);
            }
        });
        
        // 3. ETC: 이미 수동맵핑 단계에서 movedEtcIds/movedBboxMap에 저장됨
        // 자동맵핑 결과에도 동일한 bbox 사용
        manualEtcs.forEach(manualEtc => {
            if (movedEtcIds.has(manualEtc.id)) {
                const movedBbox = movedBboxMap.get(manualEtc.id);
                autoMappingResult.push({
                    id: `auto_etc_${manualEtc.id}`,
                    type: 'etc',
                    bbox: movedBbox,
                    text: manualEtc.text
                });
            }
        });
        
        const autoKeyCount = autoMappingResult.filter(a => a.type === 'key').length;
        const autoValueCount = autoMappingResult.filter(a => a.type === 'value').length;
        const autoEtcCount = autoMappingResult.filter(a => a.type === 'etc').length;
        console.log(`[자동맵핑 결과] KEY: ${autoKeyCount}개, VALUE: ${autoValueCount}개, ETC: ${autoEtcCount}개, 총: ${autoMappingResult.length}개`);

        // 수동맵핑 이동 결과는 별도 저장 (시각화용)
        state.matchedManualAnnotations = matchedManualAnnotations;
        
        state.result = {
            ...state.annotationData,
            image: state.imageFile ? state.imageFile.name : state.annotationData.image,
            annotations: autoMappingResult
        };
        
        console.log(`[결과] state.result.annotations: ${state.result.annotations.length}개`);

        // UI 업데이트 - 자동맵핑 결과 표시
        displayResults(autoMappingResult, mappedCount, emptyCount);
    }

    /**
     * 두 bbox의 겹침 비율 계산
     * @param {number[]} bbox1 - [x1, y1, x2, y2]
     * @param {number[]} bbox2 - [x1, y1, x2, y2]
     * @returns {number} 0~1 사이의 겹침 비율 (bbox2 기준)
     */
    function calculateOverlap(bbox1, bbox2) {
        const x1 = Math.max(bbox1[0], bbox2[0]);
        const y1 = Math.max(bbox1[1], bbox2[1]);
        const x2 = Math.min(bbox1[2], bbox2[2]);
        const y2 = Math.min(bbox1[3], bbox2[3]);

        if (x2 <= x1 || y2 <= y1) return 0;

        const intersectionArea = (x2 - x1) * (y2 - y1);
        const bbox2Area = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1]);

        return bbox2Area > 0 ? intersectionArea / bbox2Area : 0;
    }
    
    /**
     * OCR bbox의 중심점이 어노테이션 bbox 안에 있는지 확인
     * @param {number[]} annBbox - 어노테이션 bbox [x1, y1, x2, y2]
     * @param {number[]} ocrBbox - OCR bbox [x1, y1, x2, y2]
     * @returns {boolean}
     */
    function isOcrCenterInAnnotation(annBbox, ocrBbox) {
        // OCR bbox의 중심점 계산
        const ocrCenterX = (ocrBbox[0] + ocrBbox[2]) / 2;
        const ocrCenterY = (ocrBbox[1] + ocrBbox[3]) / 2;
        
        // 중심점이 어노테이션 안에 있는지 확인
        return ocrCenterX >= annBbox[0] && ocrCenterX <= annBbox[2] &&
               ocrCenterY >= annBbox[1] && ocrCenterY <= annBbox[3];
    }
    
    /**
     * 어노테이션 bbox의 중심점이 OCR bbox 안에 있는지 확인
     * @param {number[]} annBbox - 어노테이션 bbox [x1, y1, x2, y2]
     * @param {number[]} ocrBbox - OCR bbox [x1, y1, x2, y2]
     * @returns {boolean}
     */
    function isAnnotationCenterInOcr(annBbox, ocrBbox) {
        // 어노테이션 bbox의 중심점 계산
        const annCenterX = (annBbox[0] + annBbox[2]) / 2;
        const annCenterY = (annBbox[1] + annBbox[3]) / 2;
        
        // 중심점이 OCR 안에 있는지 확인
        return annCenterX >= ocrBbox[0] && annCenterX <= ocrBbox[2] &&
               annCenterY >= ocrBbox[1] && annCenterY <= ocrBbox[3];
    }

    /**
     * 여러 bbox를 합쳐서 하나의 bbox로 만들기 (원본 좌표 유지)
     * @param {number[][]} bboxes - [[x1, y1, x2, y2], ...]
     * @returns {number[]} 합쳐진 bbox [x1, y1, x2, y2]
     */
    function mergeBboxes(bboxes) {
        if (!bboxes || bboxes.length === 0) return null;
        if (bboxes.length === 1) return [...bboxes[0]].map(v => Math.round(v));

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        bboxes.forEach(bbox => {
            minX = Math.min(minX, bbox[0]);
            minY = Math.min(minY, bbox[1]);
            maxX = Math.max(maxX, bbox[2]);
            maxY = Math.max(maxY, bbox[3]);
        });

        // 원본 좌표 그대로 반환 (클램핑 없음)
        return [
            Math.round(minX),
            Math.round(minY),
            Math.round(maxX),
            Math.round(maxY)
        ];
    }

    /**
     * 텍스트 유사도 계산 (Levenshtein distance 기반)
     */
    function calculateTextSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        
        // 정규화: 공백 제거, 소문자 변환
        const s1 = str1.replace(/\s+/g, '').toLowerCase();
        const s2 = str2.replace(/\s+/g, '').toLowerCase();
        
        if (s1 === s2) return 1;
        if (s1.length === 0 || s2.length === 0) return 0;
        
        // 포함 관계 체크 (한쪽이 다른 쪽에 포함되면 높은 유사도)
        if (s1.includes(s2) || s2.includes(s1)) {
            const minLen = Math.min(s1.length, s2.length);
            const maxLen = Math.max(s1.length, s2.length);
            return minLen / maxLen;
        }
        
        // Levenshtein distance
        const matrix = [];
        for (let i = 0; i <= s1.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= s2.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                if (s1[i - 1] === s2[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        const distance = matrix[s1.length][s2.length];
        const maxLen = Math.max(s1.length, s2.length);
        return 1 - distance / maxLen;
    }

    /**
     * PaddleOCR words에서 가장 유사한 텍스트 찾기
     */
    function findBestTextMatch(targetText, paddleWords) {
        if (!targetText || !paddleWords || paddleWords.length === 0) return null;
        
        let bestMatch = null;
        let bestSimilarity = 0;
        
        paddleWords.forEach(word => {
            const similarity = calculateTextSimilarity(targetText, word.text);
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = { word, similarity };
            }
        });
        
        return bestMatch;
    }

    /**
     * etc용: 텍스트를 부분으로 나눠서 각각 PaddleOCR에서 매칭되는 bbox 찾기
     */
    function findPartialTextMatches(targetText, paddleWords) {
        if (!targetText || !paddleWords || paddleWords.length === 0) return [];
        
        const matchedBboxes = [];
        const usedWordIndices = new Set();
        
        // 타겟 텍스트를 공백/줄바꿈으로 분리
        const targetParts = targetText.split(/[\s\n]+/).filter(p => p.length > 0);
        
        // 각 부분에 대해 매칭되는 PaddleOCR 찾기
        targetParts.forEach(part => {
            const normalizedPart = part.replace(/\s+/g, '').toLowerCase();
            if (normalizedPart.length < 2) return;  // 너무 짧은 부분은 스킵
            
            paddleWords.forEach((word, idx) => {
                if (usedWordIndices.has(idx)) return;  // 이미 사용된 word 스킵
                
                const normalizedWord = word.text.replace(/\s+/g, '').toLowerCase();
                
                // 완전 일치 또는 포함 관계 체크
                if (normalizedWord === normalizedPart || 
                    normalizedWord.includes(normalizedPart) || 
                    normalizedPart.includes(normalizedWord)) {
                    matchedBboxes.push(word.bbox);
                    usedWordIndices.add(idx);
                    console.log(`  [부분매칭] "${part}" → "${word.text}"`);
                }
            });
        });
        
        // 부분 매칭이 없으면 유사도 기반으로 다시 시도
        if (matchedBboxes.length === 0) {
            paddleWords.forEach((word, idx) => {
                if (usedWordIndices.has(idx)) return;
                
                const similarity = calculateTextSimilarity(targetText, word.text);
                if (similarity >= 0.5) {  // 50% 이상 유사도
                    matchedBboxes.push(word.bbox);
                    usedWordIndices.add(idx);
                    console.log(`  [유사도매칭] "${word.text}" (${(similarity * 100).toFixed(1)}%)`);
                }
            });
        }
        
        return matchedBboxes;
    }

    // ============================================
    // 결과 표시
    // ============================================
    function displayResults(annotations, mapped, empty) {
        elements.resultSection.hidden = false;
        elements.totalAnnotations.textContent = annotations.length;
        elements.mappedCount.textContent = mapped;
        elements.emptyCount.textContent = empty;

        // 테이블 렌더링
        renderResultTable(annotations);

        // 시각화
        if (state.image) {
            setupVisualization();
        }

        // 결과 섹션으로 스크롤
        elements.resultSection.scrollIntoView({ behavior: 'smooth' });
    }

    function renderResultTable(annotations) {
        elements.resultTableBody.innerHTML = '';

        // KEY와 연결된 VALUE들을 그룹화하여 정렬
        const sortedAnnotations = [];
        const keys = annotations.filter(a => a.type === 'key');
        const values = annotations.filter(a => a.type === 'value');
        const etcs = annotations.filter(a => a.type === 'etc');
        
        // KEY → 해당 KEY의 VALUE들 순서로 정렬
        keys.forEach(key => {
            sortedAnnotations.push(key);
            // 이 KEY에 연결된 VALUE들 추가
            const linkedValues = values.filter(v => v.key_id === key.key_id);
            sortedAnnotations.push(...linkedValues);
        });
        
        // 연결되지 않은 VALUE들 추가
        const unlinkedValues = values.filter(v => !keys.some(k => k.key_id === v.key_id));
        sortedAnnotations.push(...unlinkedValues);
        
        // ETC 추가
        sortedAnnotations.push(...etcs);

        sortedAnnotations.forEach(ann => {
            const tr = document.createElement('tr');
            tr.dataset.id = ann.id;
            tr.style.cursor = 'pointer';
            
            // 행 클릭 시 해당 bbox 선택
            tr.addEventListener('click', (e) => {
                selectAnnotation(ann.id);
                elements.visualizationArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            
            // 타입 (읽기 전용)
            const tdType = document.createElement('td');
            const typeBadge = document.createElement('span');
            typeBadge.className = `type-badge ${ann.type}`;
            typeBadge.textContent = ann.type.toUpperCase();
            tdType.appendChild(typeBadge);
            tr.appendChild(tdType);

            // 연결된 Key (읽기 전용)
            const tdKey = document.createElement('td');
            tdKey.textContent = ann.key_id || '-';
            tdKey.style.fontFamily = 'var(--font-mono)';
            tdKey.style.color = ann.key_id ? 'var(--text-primary)' : 'var(--text-tertiary)';
            tr.appendChild(tdKey);

            // 매칭된 텍스트 (읽기 전용)
            const tdText = document.createElement('td');
            tdText.className = ann.text ? 'text-col has-text' : 'text-col no-text';
            tdText.textContent = ann.text || '(매칭 없음)';
            tdText.title = ann.text || '';
            tr.appendChild(tdText);

            // 상태 (읽기 전용)
            const tdStatus = document.createElement('td');
            const statusBadge = document.createElement('span');
            if (ann.text) {
                statusBadge.className = 'status-badge mapped';
                statusBadge.textContent = '✓ 매칭됨';
            } else {
                statusBadge.className = 'status-badge empty';
                statusBadge.textContent = '미매칭';
            }
            tdStatus.appendChild(statusBadge);
            tr.appendChild(tdStatus);

            elements.resultTableBody.appendChild(tr);
        });
    }

    // ============================================
    // 시각화
    // ============================================
    function setupVisualization() {
        elements.visImage.src = state.image;
        elements.visImage.onload = () => {
            const canvas = elements.visCanvas;
            const editCanvas = elements.editCanvas;
            
            // 캔버스 내부 해상도 설정
            canvas.width = elements.visImage.naturalWidth;
            canvas.height = elements.visImage.naturalHeight;
            editCanvas.width = elements.visImage.naturalWidth;
            editCanvas.height = elements.visImage.naturalHeight;
            
            // 이미지 표시 크기에 맞춰 캔버스 CSS 크기 설정
            // setTimeout으로 이미지 레이아웃이 완료된 후 실행
            setTimeout(() => {
                const imgRect = elements.visImage.getBoundingClientRect();
                
                // 캔버스 표시 크기를 이미지와 동일하게 설정
                canvas.style.width = imgRect.width + 'px';
                canvas.style.height = imgRect.height + 'px';
                editCanvas.style.width = imgRect.width + 'px';
                editCanvas.style.height = imgRect.height + 'px';
                
                const canvasRect = canvas.getBoundingClientRect();
                
                console.log('[이미지] 원본 크기:', elements.visImage.naturalWidth, 'x', elements.visImage.naturalHeight);
                console.log('[이미지] 표시 크기:', imgRect.width.toFixed(0), 'x', imgRect.height.toFixed(0));
                console.log('[캔버스] 내부 해상도:', canvas.width, 'x', canvas.height);
                console.log('[캔버스] 표시 크기:', canvasRect.width.toFixed(0), 'x', canvasRect.height.toFixed(0));
                console.log('[OCR] 이미지 크기:', state.ocrImageWidth, 'x', state.ocrImageHeight);
                
                state.selectedId = null;
                redrawCanvas();
                redrawEditCanvas();
            }, 50);
        };
    }

    function redrawCanvas() {
        if (!state.result || !elements.visImage.complete) return;

        const canvas = elements.visCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const showPaddle = elements.showPaddleOcr?.checked ?? true;
        const showLogistics = elements.showLogisticsOcr?.checked ?? true;
        const showAnnotation = elements.showAnnotation?.checked ?? true;
        const showResult = elements.showResult?.checked ?? true;

        // 스케일 계산
        // 결과 bbox는 OCR 좌표계로 저장되어 있음
        // 캔버스는 업로드된 이미지 크기
        // 따라서: 캔버스 / OCR이미지크기 = 스케일
        const uploadedWidth = canvas.width;  // 업로드된 이미지 크기
        const uploadedHeight = canvas.height;
        const ocrWidth = state.ocrImageWidth || uploadedWidth;
        const ocrHeight = state.ocrImageHeight || uploadedHeight;
        
        // OCR bbox → 화면 좌표 스케일
        const scaleX = uploadedWidth / ocrWidth;
        const scaleY = uploadedHeight / ocrHeight;

        // 좌표 변환 함수
        const scaleCoord = (x, y) => [x * scaleX, y * scaleY];
        const scaleBbox = (bbox) => [
            bbox[0] * scaleX,
            bbox[1] * scaleY,
            bbox[2] * scaleX,
            bbox[3] * scaleY
        ];

        // 1. PaddleOCR 박스 그리기 (빨간 실선, 굵게)
        if (showPaddle && state.paddleData && state.paddleData.words) {
            ctx.strokeStyle = '#ef4444';  // 빨간색
            ctx.lineWidth = 2.5;
            state.paddleData.words.forEach(word => {
                const [x1, y1, x2, y2] = scaleBbox(word.bbox);
                ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            });
        }

        // 2. 물류 OCR 박스 그리기 (파란 실선, 굵게)
        if (showLogistics && state.labelData && state.labelData.words) {
            ctx.strokeStyle = '#3b82f6';  // 파란색
            ctx.lineWidth = 2.5;
            state.labelData.words.forEach(word => {
                const [x1, y1, x2, y2] = scaleBbox(word.bbox);
                ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            });
        }

        // 3. 수동맵핑 bbox 그리기 (이동된 결과 표시, 단계/타입별 색상, 실선, 굵게)
        if (showAnnotation && state.matchedManualAnnotations && state.matchedManualAnnotations.length > 0) {
            const etcCount = state.matchedManualAnnotations.filter(a => a.type === 'etc').length;
            console.log(`[수동맵핑 시각화] 총 ${state.matchedManualAnnotations.length}개 (ETC ${etcCount}개)`);
            
            ctx.lineWidth = 3;
            state.matchedManualAnnotations.forEach(ann => {
                if (!ann.bbox) return;
                
                const [x1, y1, x2, y2] = scaleBbox(ann.bbox);
                const boxWidth = x2 - x1;
                const boxHeight = y2 - y1;
                
                // ETC는 채워진 박스로 눈에 띄게 그리기
                if (ann.type === 'etc') {
                    console.log(`[수동맵핑 ETC] "${ann.text?.substring(0,20)}..." bbox [${ann.bbox.join(', ')}] → 화면 [${x1.toFixed(0)}, ${y1.toFixed(0)}, ${boxWidth.toFixed(0)}x${boxHeight.toFixed(0)}]`);
                    ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';  // 시안블루 반투명
                    ctx.fillRect(x1, y1, boxWidth, boxHeight);
                    ctx.strokeStyle = '#06b6d4';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(x1, y1, boxWidth, boxHeight);
                } else {
                    // KEY, VALUE
                    if (ann._stage === 2) {
                        ctx.strokeStyle = ann.type === 'key' ? '#ef4444' : '#3b82f6';
                    } else {
                        ctx.strokeStyle = ann.type === 'key' ? '#fb923c' : '#86efac';
                    }
                    ctx.lineWidth = 3;
                    ctx.strokeRect(x1, y1, boxWidth, boxHeight);
                }
            });
        }

        // 4. 자동맵핑 결과 bbox 그리기 (실선 + 배경)
        if (showResult && state.result.annotations) {
            const etcCount = state.result.annotations.filter(a => a.type === 'etc').length;
            console.log(`[시각화] 자동맵핑 결과 그리기: 총 ${state.result.annotations.length}개, ETC ${etcCount}개`);
            console.log(`[시각화] 캔버스 크기: ${canvas.width}x${canvas.height}, OCR이미지: ${state.ocrImageWidth || 'N/A'}x${state.ocrImageHeight || 'N/A'}, 스케일: ${scaleX.toFixed(2)}x${scaleY.toFixed(2)}`);
            
            
            state.result.annotations.forEach(ann => {
                if (!ann.bbox) {
                    console.log(`[시각화] bbox 없음: ${ann.type} ${ann.id}`);
                    return;
                }

                // 스케일 적용 후 화면 범위로 클램핑
                const scaled = scaleBbox(ann.bbox);
                const clampedBbox = [
                    Math.max(0, Math.min(scaled[0], canvas.width)),
                    Math.max(0, Math.min(scaled[1], canvas.height)),
                    Math.max(0, Math.min(scaled[2], canvas.width)),
                    Math.max(0, Math.min(scaled[3], canvas.height))
                ];
                
                const [x1, y1, x2, y2] = clampedBbox;
                const boxWidth = x2 - x1;
                const boxHeight = y2 - y1;
                
                // 너무 작거나 유효하지 않은 bbox 스킵
                if (boxWidth <= 0 || boxHeight <= 0) {
                    console.log(`[시각화] 유효하지 않은 bbox: ${ann.type} ${ann.id}, size: ${boxWidth}x${boxHeight}`);
                    return;
                }

                // 타입별 색상 (key 주황, value 연두, etc 시안블루)
                let color;
                let lineWidth = 3;
                switch (ann.type) {
                    case 'key':
                        // KEY는 매칭 성공/실패 여부에 따라 색상 변경
                        if (ann._matchSuccess === false) {
                            color = '#ef4444'; // 빨간색 (매칭 실패)
                            lineWidth = 4;  // 더 굵게
                        } else {
                            color = '#fb923c'; // 주황색 (매칭 성공)
                        }
                        break;
                    case 'value':
                        color = '#86efac'; // 연두
                        break;
                    case 'etc':
                        color = '#06b6d4'; // 시안블루
                        console.log(`[시각화] ETC 그리기: "${ann.text?.substring(0,20)}..." 원본bbox [${ann.bbox.join(', ')}] → 스케일 [${x1.toFixed(0)}, ${y1.toFixed(0)}, ${boxWidth.toFixed(0)}x${boxHeight.toFixed(0)}]`);
                        break;
                    default:
                        color = '#e94560';
                }

                // ETC는 채워진 박스 + 테두리로 그리기 (더 눈에 띄게)
                if (ann.type === 'etc') {
                    // 반투명 배경
                    ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';  // 시안블루 반투명
                ctx.fillRect(x1, y1, boxWidth, boxHeight);
                    // 굵은 테두리
                    ctx.strokeStyle = '#06b6d4';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(x1, y1, boxWidth, boxHeight);
                } else {
                    // KEY, VALUE는 테두리만
                ctx.strokeStyle = color;
                    ctx.lineWidth = lineWidth;
                ctx.strokeRect(x1, y1, boxWidth, boxHeight);
                }
            });
        }
    }

    /**
     * 텍스트를 주어진 너비에 맞게 줄바꿈
     */
    function wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    }

    function adjustZoom(delta) {
        setZoom(state.zoom + delta);
    }

    function setZoom(value) {
        state.zoom = Math.max(50, Math.min(500, value));
        elements.visZoomLevel.textContent = state.zoom + '%';
        elements.visCanvasContainer.style.transform = `scale(${state.zoom / 100})`;
    }

    // ============================================
    // 스케일 계산 유틸리티
    // ============================================
    function getScale() {
        const canvas = elements.editCanvas || elements.visCanvas;
        if (!canvas || !state.result) return { scaleX: 1, scaleY: 1 };
        
        // 결과 bbox는 OCR 좌표계
        // 캔버스는 업로드된 이미지 크기
        const uploadedWidth = canvas.width;
        const uploadedHeight = canvas.height;
        const ocrWidth = state.ocrImageWidth || uploadedWidth;
        const ocrHeight = state.ocrImageHeight || uploadedHeight;
        
        return {
            scaleX: uploadedWidth / ocrWidth,
            scaleY: uploadedHeight / ocrHeight
        };
    }

    function toScreenCoords(bbox) {
        const { scaleX, scaleY } = getScale();
        return [
            bbox[0] * scaleX,
            bbox[1] * scaleY,
            bbox[2] * scaleX,
            bbox[3] * scaleY
        ];
    }

    function toOriginalCoords(bbox) {
        const { scaleX, scaleY } = getScale();
        return [
            Math.round(bbox[0] / scaleX),
            Math.round(bbox[1] / scaleY),
            Math.round(bbox[2] / scaleX),
            Math.round(bbox[3] / scaleY)
        ];
    }

    // ============================================
    // 편집 캔버스 (선택 및 핸들 표시)
    // ============================================
    function redrawEditCanvas() {
        if (!elements.editCanvas) return;
        
        const canvas = elements.editCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (state.selectedId === null || !state.result) return;

        const ann = state.result.annotations.find(a => a.id === state.selectedId);
        if (!ann || !ann.bbox) return;

        // 화면 좌표로 변환
        const screenBbox = toScreenCoords(ann.bbox);
        const [x1, y1, x2, y2] = screenBbox;
        const boxWidth = x2 - x1;
        const boxHeight = y2 - y1;

        // 선택 테두리 (강조)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.strokeRect(x1, y1, boxWidth, boxHeight);

        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x1, y1, boxWidth, boxHeight);
        ctx.setLineDash([]);

        // 리사이즈 핸들 그리기
        const handles = getResizeHandles(ann.bbox);
        handles.forEach(handle => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(handle.x - HANDLE_SIZE/2 - 1, handle.y - HANDLE_SIZE/2 - 1, HANDLE_SIZE + 2, HANDLE_SIZE + 2);
            ctx.fillStyle = '#e94560';
            ctx.fillRect(handle.x - HANDLE_SIZE/2, handle.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
        });
    }

    function getResizeHandles(originalBbox) {
        // 화면 좌표로 변환
        const [x1, y1, x2, y2] = toScreenCoords(originalBbox);
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        return [
            { x: x1, y: y1, cursor: 'nw-resize', type: 'nw' },
            { x: midX, y: y1, cursor: 'n-resize', type: 'n' },
            { x: x2, y: y1, cursor: 'ne-resize', type: 'ne' },
            { x: x2, y: midY, cursor: 'e-resize', type: 'e' },
            { x: x2, y: y2, cursor: 'se-resize', type: 'se' },
            { x: midX, y: y2, cursor: 's-resize', type: 's' },
            { x: x1, y: y2, cursor: 'sw-resize', type: 'sw' },
            { x: x1, y: midY, cursor: 'w-resize', type: 'w' }
        ];
    }

    // ============================================
    // 마우스 이벤트 핸들러
    // ============================================
    function getMousePos(e) {
        const canvas = elements.editCanvas;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    function findAnnotationAtPos(x, y) {
        if (!state.result) return null;
        
        // 역순으로 검색 (위에 그려진 것 먼저)
        for (let i = state.result.annotations.length - 1; i >= 0; i--) {
            const ann = state.result.annotations[i];
            if (!ann.bbox) continue;
            
            // 화면 좌표로 변환해서 비교
            const [x1, y1, x2, y2] = toScreenCoords(ann.bbox);
            if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
                return ann;
            }
        }
        return null;
    }

    function findHandleAtPos(x, y) {
        if (state.selectedId === null || !state.result) return null;

        const ann = state.result.annotations.find(a => a.id === state.selectedId);
        if (!ann || !ann.bbox) return null;

        const handles = getResizeHandles(ann.bbox);
        for (const handle of handles) {
            const dist = Math.sqrt((x - handle.x) ** 2 + (y - handle.y) ** 2);
            if (dist <= HANDLE_SIZE) {
                return handle;
            }
        }
        return null;
    }

    function handleEditMouseDown(e) {
        if (!state.result) return;

        const pos = getMousePos(e);
        
        // 핸들 클릭 확인
        const handle = findHandleAtPos(pos.x, pos.y);
        if (handle) {
            state.isResizing = true;
            state.resizeHandle = handle.type;
            state.dragStartX = pos.x;
            state.dragStartY = pos.y;
            const ann = state.result.annotations.find(a => a.id === state.selectedId);
            state.originalBbox = [...ann.bbox];
            return;
        }

        // bbox 클릭 확인
        const ann = findAnnotationAtPos(pos.x, pos.y);
        if (ann) {
            if (state.selectedId === ann.id) {
                // 이미 선택된 것 클릭 → 드래그 시작
                state.isDragging = true;
                state.dragStartX = pos.x;
                state.dragStartY = pos.y;
                state.originalBbox = [...ann.bbox];
            } else {
                // 새로운 것 선택
                selectAnnotation(ann.id);
            }
        } else {
            // 빈 공간 클릭 → 새 bbox 드래그 시작
            deselectAnnotation();
            state.isDrawing = true;
            state.drawStartX = pos.x;
            state.drawStartY = pos.y;
        }
    }

    function handleEditMouseMove(e) {
        const pos = getMousePos(e);
        const { scaleX, scaleY } = getScale();

        // 새 bbox 드래그 중
        if (state.isDrawing) {
            redrawEditCanvas();
            drawTempBox(state.drawStartX, state.drawStartY, pos.x, pos.y);
            return;
        }

        if (state.isDragging && state.selectedId !== null) {
            // 드래그로 이동 (화면 좌표 차이를 원본 좌표로 변환)
            const dx = (pos.x - state.dragStartX) / scaleX;
            const dy = (pos.y - state.dragStartY) / scaleY;
            
            const ann = state.result.annotations.find(a => a.id === state.selectedId);
            if (ann) {
                ann.bbox = [
                    Math.round(state.originalBbox[0] + dx),
                    Math.round(state.originalBbox[1] + dy),
                    Math.round(state.originalBbox[2] + dx),
                    Math.round(state.originalBbox[3] + dy)
                ];
                redrawCanvas();
                redrawEditCanvas();
                updateEditPanelBbox(ann.bbox);
            }
        } else if (state.isResizing && state.selectedId !== null) {
            // 리사이즈 (화면 좌표 차이를 원본 좌표로 변환)
            const ann = state.result.annotations.find(a => a.id === state.selectedId);
            if (ann) {
                const newBbox = [...state.originalBbox];
                const dx = (pos.x - state.dragStartX) / scaleX;
                const dy = (pos.y - state.dragStartY) / scaleY;

                switch (state.resizeHandle) {
                    case 'nw':
                        newBbox[0] = Math.round(state.originalBbox[0] + dx);
                        newBbox[1] = Math.round(state.originalBbox[1] + dy);
                        break;
                    case 'n':
                        newBbox[1] = Math.round(state.originalBbox[1] + dy);
                        break;
                    case 'ne':
                        newBbox[2] = Math.round(state.originalBbox[2] + dx);
                        newBbox[1] = Math.round(state.originalBbox[1] + dy);
                        break;
                    case 'e':
                        newBbox[2] = Math.round(state.originalBbox[2] + dx);
                        break;
                    case 'se':
                        newBbox[2] = Math.round(state.originalBbox[2] + dx);
                        newBbox[3] = Math.round(state.originalBbox[3] + dy);
                        break;
                    case 's':
                        newBbox[3] = Math.round(state.originalBbox[3] + dy);
                        break;
                    case 'sw':
                        newBbox[0] = Math.round(state.originalBbox[0] + dx);
                        newBbox[3] = Math.round(state.originalBbox[3] + dy);
                        break;
                    case 'w':
                        newBbox[0] = Math.round(state.originalBbox[0] + dx);
                        break;
                }

                // 최소 크기 보장 (원본 좌표 기준)
                if (newBbox[2] - newBbox[0] >= 10 && newBbox[3] - newBbox[1] >= 10) {
                    ann.bbox = newBbox;
                    redrawCanvas();
                    redrawEditCanvas();
                    updateEditPanelBbox(ann.bbox);
                }
            }
        } else {
            // 커서 변경
            updateCursor(pos);
        }
    }

    function handleEditMouseUp(e) {
        // 새 bbox 드래그 완료
        if (state.isDrawing) {
            state.isDrawing = false;
            const pos = getMousePos(e);
            
            // 최소 크기 확인 (10px 이상)
            const width = Math.abs(pos.x - state.drawStartX);
            const height = Math.abs(pos.y - state.drawStartY);
            
            if (width >= 10 && height >= 10) {
                // 화면 좌표를 원본 좌표로 변환
                const screenBbox = [
                    Math.min(state.drawStartX, pos.x),
                    Math.min(state.drawStartY, pos.y),
                    Math.max(state.drawStartX, pos.x),
                    Math.max(state.drawStartY, pos.y)
                ];
                const drawnBbox = toOriginalCoords(screenBbox);
                
                // 미매핑된 어노테이션 목록 표시
                showUnmappedSelector(drawnBbox);
            } else {
                redrawEditCanvas();
            }
            return;
        }
        
        if (state.isDragging || state.isResizing) {
            state.isDragging = false;
            state.isResizing = false;
            state.resizeHandle = null;
            state.originalBbox = null;
            
            // 테이블 업데이트
            if (state.result) {
                renderResultTable(state.result.annotations);
            }
        }
    }

    function handleEditDoubleClick(e) {
        const pos = getMousePos(e);
        const ann = findAnnotationAtPos(pos.x, pos.y);
        
        if (ann) {
            selectAnnotation(ann.id);
            openEditPanel(ann);
            elements.editText.focus();
        }
    }

    function updateCursor(pos) {
        const canvas = elements.editCanvas;
        
        // 핸들 위인지 확인
        const handle = findHandleAtPos(pos.x, pos.y);
        if (handle) {
            canvas.style.cursor = handle.cursor;
            return;
        }

        // bbox 위인지 확인
        const ann = findAnnotationAtPos(pos.x, pos.y);
        if (ann) {
            if (state.selectedId === ann.id) {
                canvas.style.cursor = 'move';
            } else {
                canvas.style.cursor = 'pointer';
            }
        } else {
            canvas.style.cursor = 'default';
        }
    }

    // ============================================
    // 선택
    // ============================================
    function selectAnnotation(id) {
        state.selectedId = id;
        redrawEditCanvas();
    }

    function deselectAnnotation() {
        state.selectedId = null;
        redrawEditCanvas();
    }


    function openEditPanel(ann) {
        if (!elements.editPanel) return;
        
        elements.editPanel.hidden = false;
        elements.editType.textContent = ann.type.toUpperCase();
        elements.editType.className = `edit-type ${ann.type}`;
        
        // KEY 또는 VALUE 타입인 경우 key_id 입력 필드 표시
        if (ann.type === 'key' || ann.type === 'value') {
            elements.editKeyIdField.style.display = 'block';
            elements.editKeyId.value = ann.key_id || '';
            
            // 라벨 텍스트 변경
            const label = elements.editKeyIdField.querySelector('label');
            if (ann.type === 'key') {
                label.textContent = 'Key ID';
            } else {
                label.textContent = '연결된 Key ID';
            }
        } else {
            elements.editKeyIdField.style.display = 'none';
        }
        
        elements.editText.value = ann.text || '';
    }

    function closeEditPanel() {
        elements.editPanel.hidden = true;
        state.selectedId = null;
        redrawEditCanvas();
    }

    function updateEditPanelBbox(bbox) {
        if (!elements.editPanel.hidden && bbox) {
            elements.editX1.value = bbox[0];
            elements.editY1.value = bbox[1];
            elements.editX2.value = bbox[2];
            elements.editY2.value = bbox[3];
        }
    }

    function applyEdit() {
        if (state.selectedId === null || !state.result) return;

        const ann = state.result.annotations.find(a => a.id === state.selectedId);
        if (!ann) return;

        // key_id 업데이트 (KEY 또는 VALUE 타입인 경우)
        if (ann.type === 'key' || ann.type === 'value') {
            const keyIdValue = elements.editKeyId.value.trim();
            if (keyIdValue) {
                // 숫자로 변환 가능하면 숫자로, 아니면 문자열로 저장
                const numValue = parseInt(keyIdValue);
                ann.key_id = !isNaN(numValue) ? numValue : keyIdValue;
            }
        }

        // 텍스트 업데이트
        ann.text = elements.editText.value || null;

        // UI 업데이트
        redrawCanvas();
        redrawEditCanvas();
        renderResultTable(state.result.annotations);
        updateStats();
        
        // 패널 닫기
        closeEditPanel();
    }

    function updateStats() {
        if (!state.result) return;
        
        let mapped = 0;
        let empty = 0;
        
        state.result.annotations.forEach(ann => {
            if (ann.text) {
                mapped++;
            } else {
                empty++;
            }
        });
        
        elements.mappedCount.textContent = mapped;
        elements.emptyCount.textContent = empty;
    }

    // ============================================
    // 새 bbox 드래그로 그리기
    // ============================================
    function drawTempBox(x1, y1, x2, y2) {
        const canvas = elements.editCanvas;
        const ctx = canvas.getContext('2d');
        
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        
        // 반투명 파란색 박스
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(left, top, width, height);
        
        // 파란색 점선 테두리
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(left, top, width, height);
        ctx.setLineDash([]);
        
        // 크기 표시
        const { scaleX, scaleY } = getScale();
        const realWidth = Math.round(width / scaleX);
        const realHeight = Math.round(height / scaleY);
        ctx.font = '12px "Noto Sans KR", sans-serif';
        ctx.fillStyle = '#3b82f6';
        ctx.fillText(`${realWidth} × ${realHeight}`, left + 5, top - 5);
    }

    /**
     * 미매핑 어노테이션 선택 팝업 표시
     */
    function showUnmappedSelector(drawnBbox) {
        // 미매핑 항목 찾기
        const unmapped = state.result.annotations.filter(ann => !ann.text);
        
        if (unmapped.length === 0) {
            alert('모든 항목이 이미 매핑되어 있습니다.');
            redrawEditCanvas();
            return;
        }
        
        // 그려진 bbox 영역 내의 OCR 텍스트 찾기
        const matchedText = findOcrTextInBbox(drawnBbox);
        
        // 팝업 생성
        const popup = document.createElement('div');
        popup.className = 'unmapped-selector-popup';
        popup.innerHTML = `
            <div class="popup-header">
                <h4>📝 항목 선택</h4>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-body">
                <p class="popup-desc">이 bbox를 적용할 미매핑 항목을 선택하세요:</p>
                <div class="unmapped-list">
                    ${unmapped.map(ann => `
                        <div class="unmapped-item" data-id="${ann.id}">
                            <span class="item-id">#${ann.id}</span>
                            <span class="item-type ${ann.type}">${ann.type.toUpperCase()}</span>
                            ${ann.key_id ? `<span class="item-key">Key: #${ann.key_id}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="popup-text-section">
                    <label>텍스트 (OCR에서 ${matchedText.length}개 텍스트 발견):</label>
                    <textarea class="popup-text-input" placeholder="텍스트를 입력하거나 OCR 텍스트를 사용합니다">${matchedText.join(' ')}</textarea>
                </div>
            </div>
            <div class="popup-footer">
                <button class="btn-cancel">취소</button>
                <button class="btn-apply" disabled>적용</button>
            </div>
        `;
        
        document.body.appendChild(popup);
        
        let selectedAnnId = null;
        
        // 항목 선택 이벤트
        popup.querySelectorAll('.unmapped-item').forEach(item => {
            item.addEventListener('click', () => {
                popup.querySelectorAll('.unmapped-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                selectedAnnId = parseInt(item.dataset.id);
                popup.querySelector('.btn-apply').disabled = false;
            });
        });
        
        // 닫기 버튼
        popup.querySelector('.popup-close').addEventListener('click', () => {
            popup.remove();
            redrawEditCanvas();
        });
        
        popup.querySelector('.btn-cancel').addEventListener('click', () => {
            popup.remove();
            redrawEditCanvas();
        });
        
        // 적용 버튼
        popup.querySelector('.btn-apply').addEventListener('click', () => {
            if (selectedAnnId !== null) {
                const ann = state.result.annotations.find(a => a.id === selectedAnnId);
                if (ann) {
                    // bbox와 텍스트 업데이트
                    ann.bbox = drawnBbox;
                    ann.text = popup.querySelector('.popup-text-input').value.trim() || null;
                    
                    // UI 업데이트
                    redrawCanvas();
                    redrawEditCanvas();
                    renderResultTable(state.result.annotations);
                    updateStats();
                    
                    // 선택
                    selectAnnotation(ann.id);
                }
            }
            popup.remove();
        });
        
        // ESC로 닫기
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                popup.remove();
                redrawEditCanvas();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
    }

    /**
     * 주어진 bbox 안에 있는 OCR 텍스트 찾기 (두 소스 모두 확인)
     */
    function findOcrTextInBbox(bbox) {
        // 두 OCR 소스의 words 합치기
        let allWords = [];
        if (state.labelData && state.labelData.words) {
            allWords = allWords.concat(state.labelData.words);
        }
        if (state.paddleData && state.paddleData.words) {
            allWords = allWords.concat(state.paddleData.words);
        }
        
        if (allWords.length === 0) return [];
        
        const threshold = parseInt(elements.overlapThreshold?.value || 30) / 100;
        const matched = [];
        
        allWords.forEach(word => {
            const overlap = calculateOverlap(bbox, word.bbox);
            if (overlap >= threshold) {
                matched.push({
                    text: word.text,
                    bbox: word.bbox,
                    y: word.bbox[1],
                    x: word.bbox[0]
                });
            }
        });
        
        // 위치 기반 정렬
        matched.sort((a, b) => {
            const yDiff = a.y - b.y;
            if (Math.abs(yDiff) > 10) return yDiff;
            return a.x - b.x;
        });
        
        return matched.map(m => m.text);
    }

    // ============================================
    // 결과 다운로드 (수동맵핑 결과 JSON)
    // ============================================
    function downloadManualResult() {
        if (!state.matchedManualAnnotations || state.matchedManualAnnotations.length === 0) {
            alert('먼저 자동 맵핑을 실행해주세요.');
            return;
        }

        // 디버깅 필드 및 id 제거
        const cleanAnnotations = state.matchedManualAnnotations.map(ann => {
            const { id, _movedFrom, _delta, _stage, _matchedWords, _matched, ...cleanAnn } = ann;
                return cleanAnn;
        });

        // 원본 annotationData 구조 유지하면서 annotations만 교체
        const result = {
            ...state.annotationData,
            annotations: cleanAnnotations
        };

        // 파일명을 이미지 이름 기반으로 생성
        let filename = 'manual_mapped_annotations.json';
        if (state.imageFile) {
            const imageName = state.imageFile.name;
            const nameWithoutExt = imageName.replace(/\.[^/.]+$/, '');
            filename = nameWithoutExt + '_manual.json';
        }

        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log(`[다운로드] 수동맵핑 결과 저장: ${cleanAnnotations.length}개 항목`);
    }

    // ============================================
    // 결과 다운로드 (자동맵핑 결과 JSON)
    // ============================================
    function downloadAutoResult() {
        if (!state.result || !state.result.annotations || state.result.annotations.length === 0) {
            alert('먼저 자동 맵핑을 실행해주세요.');
            return;
        }

        // 디버깅 필드 및 id 제거, value_order를 order로 변경
        const cleanAnnotations = state.result.annotations.map(ann => {
            const { id, _movedFrom, _delta, _stage, _matchedWords, _matchSuccess, value_order, ...cleanAnn } = ann;
            
            // VALUE인 경우 value_order를 order로 변경
            if (cleanAnn.type === 'value' && value_order !== undefined) {
                return {
                    ...cleanAnn,
                    order: value_order
                };
            }
            
            return cleanAnn;
        });

        // 원본 annotationData 구조 유지하면서 annotations만 교체
        const result = {
            ...state.result,
            annotations: cleanAnnotations
        };

        // 파일명을 이미지 이름 기반으로 생성
        let filename = 'auto_mapped_annotations.json';
        if (state.imageFile) {
            const imageName = state.imageFile.name;
            const nameWithoutExt = imageName.replace(/\.[^/.]+$/, '');
            filename = nameWithoutExt + '_auto.json';
        }

        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        const keys = cleanAnnotations.filter(a => a.type === 'key');
        const values = cleanAnnotations.filter(a => a.type === 'value');
        const etcs = cleanAnnotations.filter(a => a.type === 'etc');
        console.log(`[다운로드] 자동맵핑 결과 저장: ${keys.length}개 KEY, ${values.length}개 VALUE, ${etcs.length}개 ETC`);
    }

    // ============================================
    // 초기화 실행
    // ============================================
    document.addEventListener('DOMContentLoaded', init);
})();
