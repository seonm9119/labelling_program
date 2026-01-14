/**
 * Key-Value 수정 뷰어 JavaScript - 폴더 업로드 방식
 */

(function() {
    'use strict';

    // 상태 관리
    const state = {
        imageFiles: [],       // {name, file, url} - 이미지 파일들
        jsonFiles: [],        // {name, file, data} - JSON 파일들
        currentIndex: 0,
        currentJsonData: null,
        zoom: 100,
        selectedId: null,
        isModified: false,
        // 드래그 상태
        isDragging: false,
        dragTarget: null,
        dragStartX: 0,
        dragStartY: 0,
        dragOriginalBbox: null,
        // 크기 조정 상태
        isResizing: false,
        resizeTarget: null,
        resizeHandle: null,
        resizeOriginalBbox: null,
        // 선택된 어노테이션 (목록에서 클릭)
        focusedAnnotationId: null
    };

    // DOM 요소
    const elements = {
        // 폴더 업로드
        imageUploadArea: document.getElementById('imageUploadArea'),
        imageFolderInput: document.getElementById('imageFolderInput'),
        jsonUploadArea: document.getElementById('jsonUploadArea'),
        jsonFolderInput: document.getElementById('jsonFolderInput'),
        imageFolderStatus: document.getElementById('imageFolderStatus'),
        jsonFolderStatus: document.getElementById('jsonFolderStatus'),
        imageFolderInfo: document.getElementById('imageFolderInfo'),
        jsonFolderInfo: document.getElementById('jsonFolderInfo'),
        startViewer: document.getElementById('startViewer'),
        
        // 뷰어
        viewerSection: document.getElementById('viewerSection'),
        currentFileName: document.getElementById('currentFileName'),
        fileCounter: document.getElementById('fileCounter'),
        prevBtn: document.getElementById('prevBtn'),
        nextBtn: document.getElementById('nextBtn'),
        saveBtn: document.getElementById('saveBtn'),
        
        viewerImage: document.getElementById('viewerImage'),
        bboxCanvas: document.getElementById('bboxCanvas'),
        canvasContainer: document.getElementById('canvasContainer'),
        canvasWrapper: document.getElementById('canvasWrapper'),
        zoomIn: document.getElementById('zoomIn'),
        zoomOut: document.getElementById('zoomOut'),
        zoomReset: document.getElementById('zoomReset'),
        zoomLevel: document.getElementById('zoomLevel'),
        
        // 어노테이션 리스트
        annotationCount: document.getElementById('annotationCount'),
        annotationListBody: document.getElementById('annotationListBody'),
        
        // 편집 팝업
        editPopup: document.getElementById('editPopup'),
        popupClose: document.getElementById('popupClose'),
        editType: document.getElementById('editType'),
        keyIdGroup: document.getElementById('keyIdGroup'),
        editKeyId: document.getElementById('editKeyId'),
        editText: document.getElementById('editText'),
        linkedValuesGroup: document.getElementById('linkedValuesGroup'),
        linkedValuesList: document.getElementById('linkedValuesList'),
        cancelEdit: document.getElementById('cancelEdit'),
        saveEdit: document.getElementById('saveEdit')
    };

    // 초기화
    function init() {
        setupEventListeners();
    }

    function setupEventListeners() {
        // 폴더 업로드
        setupFolderUpload(elements.imageUploadArea, elements.imageFolderInput, handleImageFolderUpload);
        setupFolderUpload(elements.jsonUploadArea, elements.jsonFolderInput, handleJsonFolderUpload);
        
        elements.startViewer.addEventListener('click', startViewer);
        
        // 네비게이션
        elements.prevBtn.addEventListener('click', () => navigateImage(-1));
        elements.nextBtn.addEventListener('click', () => navigateImage(1));
        elements.saveBtn.addEventListener('click', downloadCurrentJson);
        
        // 방향키 네비게이션 및 줌
        document.addEventListener('keydown', (e) => {
            if (elements.viewerSection.hidden || !elements.editPopup.hidden) return;
            
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigateImage(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigateImage(1);
            } else if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                adjustZoom(10);
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                adjustZoom(-10);
            }
        });
        
        // 뷰어 컨트롤
        elements.zoomIn.addEventListener('click', () => adjustZoom(10));
        elements.zoomOut.addEventListener('click', () => adjustZoom(-10));
        elements.zoomReset.addEventListener('click', () => setZoom(100));
        
        // 캔버스 드래그/크기조정 이벤트
        elements.bboxCanvas.addEventListener('mousedown', handleCanvasMouseDown);
        elements.bboxCanvas.addEventListener('mousemove', handleCanvasMouseMove);
        elements.bboxCanvas.addEventListener('mouseup', handleCanvasMouseUp);
        elements.bboxCanvas.addEventListener('mouseleave', handleCanvasMouseUp);
        elements.bboxCanvas.addEventListener('dblclick', handleCanvasDblClick);
        elements.bboxCanvas.style.cursor = 'default';
        
        // 편집 팝업
        elements.popupClose.addEventListener('click', closeEditPopup);
        elements.cancelEdit.addEventListener('click', closeEditPopup);
        elements.saveEdit.addEventListener('click', saveEdit);
        elements.editKeyId.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
        
        // ESC로 팝업 닫기
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !elements.editPopup.hidden) {
                closeEditPopup();
            }
        });
    }

    function setupFolderUpload(uploadArea, inputElement, handler) {
        if (!uploadArea || !inputElement) return;
        
        uploadArea.addEventListener('click', () => inputElement.click());
        inputElement.addEventListener('change', handler);
        
        // 드래그 앤 드롭
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadArea.classList.add('drag-over');
        });
        
        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadArea.classList.remove('drag-over');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadArea.classList.remove('drag-over');
            
            const items = e.dataTransfer.items;
            if (items) {
                handleDroppedItems(items, handler);
            }
        });
    }

    async function handleDroppedItems(items, handler) {
        const files = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry && entry.isDirectory) {
                    const folderFiles = await readDirectoryFiles(entry);
                    files.push(...folderFiles);
                } else {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
        }
        
        if (files.length > 0) {
            handler({ target: { files: files } });
        }
    }

    function readDirectoryFiles(directoryEntry) {
        return new Promise((resolve) => {
            const files = [];
            const reader = directoryEntry.createReader();
            
            function readEntries() {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) {
                        resolve(files);
                    } else {
                        for (const entry of entries) {
                            if (entry.isFile) {
                                const file = await getFileFromEntry(entry);
                                if (file) files.push(file);
                            }
                        }
                        readEntries();
                    }
                });
            }
            
            readEntries();
        });
    }

    function getFileFromEntry(fileEntry) {
        return new Promise((resolve) => {
            fileEntry.file(resolve, () => resolve(null));
        });
    }

    // ============================================
    // 폴더 업로드 핸들러
    // ============================================
    function handleImageFolderUpload(e) {
        const files = Array.from(e.target.files);
        const imageFiles = files.filter(f => 
            /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(f.name)
        );
        
        // 이미지 파일들을 이름순으로 정렬
        imageFiles.sort((a, b) => a.name.localeCompare(b.name));
        
        state.imageFiles = imageFiles.map(f => ({
            name: f.name,
            file: f,
            url: URL.createObjectURL(f)
        }));
        
        if (state.imageFiles.length > 0) {
            elements.imageFolderInfo.textContent = `✅ ${state.imageFiles.length}개 이미지 파일 선택됨`;
            elements.imageFolderStatus.textContent = '선택됨';
            elements.imageFolderStatus.className = 'status-badge status-success';
        } else {
            elements.imageFolderInfo.textContent = '❌ 이미지 파일이 없습니다';
            elements.imageFolderStatus.textContent = '미선택';
            elements.imageFolderStatus.className = 'status-badge';
        }
        
        updateStartButton();
    }

    async function handleJsonFolderUpload(e) {
        const files = Array.from(e.target.files);
        const jsonFiles = files.filter(f => f.name.endsWith('.json'));
        
        // JSON 파일들을 이름순으로 정렬
        jsonFiles.sort((a, b) => a.name.localeCompare(b.name));
        
        // JSON 파일 내용 로드
        state.jsonFiles = [];
        for (const f of jsonFiles) {
            try {
                const text = await readFileAsText(f);
                const data = JSON.parse(text);
                state.jsonFiles.push({
                    name: f.name,
                    file: f,
                    data: data
                });
            } catch (err) {
                console.error(`JSON 파싱 오류: ${f.name}`, err);
            }
        }
        
        if (state.jsonFiles.length > 0) {
            elements.jsonFolderInfo.textContent = `✅ ${state.jsonFiles.length}개 JSON 파일 선택됨`;
            elements.jsonFolderStatus.textContent = '선택됨';
            elements.jsonFolderStatus.className = 'status-badge status-success';
        } else {
            elements.jsonFolderInfo.textContent = '❌ JSON 파일이 없습니다';
            elements.jsonFolderStatus.textContent = '미선택';
            elements.jsonFolderStatus.className = 'status-badge';
        }
        
        updateStartButton();
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('파일 읽기 오류'));
            reader.readAsText(file);
        });
    }

    function updateStartButton() {
        const ready = state.imageFiles.length > 0 && state.jsonFiles.length > 0;
        elements.startViewer.disabled = !ready;
    }

    // ============================================
    // 뷰어 시작
    // ============================================
    function startViewer() {
        if (state.imageFiles.length === 0 || state.jsonFiles.length === 0) return;
        
        // 경로 섹션 숨기고 뷰어 표시
        document.querySelector('.path-section').hidden = true;
        elements.viewerSection.hidden = false;
        
        state.currentIndex = 0;
        loadCurrentFile();
    }

    function loadCurrentFile() {
        if (state.imageFiles.length === 0) return;
        
        const imageFile = state.imageFiles[state.currentIndex];
        const baseName = imageFile.name.replace(/\.(jpg|jpeg|png|gif|bmp|webp)$/i, '');
        
        // 해당 이미지의 JSON 파일 찾기
        const jsonFile = state.jsonFiles.find(j => 
            j.name.replace('.json', '') === baseName
        );
        
        // 이미지 로드
        elements.viewerImage.src = imageFile.url;
        elements.viewerImage.onload = () => {
            const img = elements.viewerImage;
            elements.bboxCanvas.width = img.naturalWidth;
            elements.bboxCanvas.height = img.naturalHeight;
            elements.canvasContainer.style.width = img.naturalWidth + 'px';
            elements.canvasContainer.style.height = img.naturalHeight + 'px';
            
            if (jsonFile) {
                state.currentJsonData = JSON.parse(JSON.stringify(jsonFile.data)); // 깊은 복사
            } else {
                state.currentJsonData = { annotations: [] };
            }
            
            // 각 어노테이션에 임시 id 부여 (없는 경우)
            if (state.currentJsonData.annotations) {
                state.currentJsonData.annotations.forEach((ann, idx) => {
                    if (!ann.id) {
                        ann.id = `temp_${ann.type || 'ann'}_${idx}`;
                    }
                });
            }
            
            drawBboxes();
            renderAnnotationList();
        };
        
        // UI 업데이트
        elements.currentFileName.textContent = imageFile.name;
        elements.fileCounter.textContent = `${state.currentIndex + 1} / ${state.imageFiles.length}`;
        elements.prevBtn.disabled = state.currentIndex === 0;
        elements.nextBtn.disabled = state.currentIndex === state.imageFiles.length - 1;
        
        state.focusedAnnotationId = null;
    }

    function navigateImage(delta) {
        const newIndex = state.currentIndex + delta;
        if (newIndex < 0 || newIndex >= state.imageFiles.length) return;
        
        state.currentIndex = newIndex;
        loadCurrentFile();
    }

    // ============================================
    // Bbox 그리기
    // ============================================
    function drawBboxes() {
        const canvas = elements.bboxCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (!state.currentJsonData || !state.currentJsonData.annotations) return;
        
        const HANDLE_SIZE = 8;
        
        state.currentJsonData.annotations.forEach(ann => {
            const [x1, y1, x2, y2] = ann.bbox;
            const width = x2 - x1;
            const height = y2 - y1;
            
            // 선택된 어노테이션인지 확인
            const isFocused = state.focusedAnnotationId === ann.id;
            
            // 타입별 색상
            let color;
            if (isFocused) {
                color = '#ff0000'; // 빨간색 강조
            } else if (ann.type === 'key') {
                color = '#3b82f6';
            } else if (ann.type === 'value') {
                color = '#10b981';
            } else {
                color = '#f59e0b';
            }
            
            ctx.strokeStyle = color;
            ctx.lineWidth = isFocused ? 4 : 2;
            ctx.setLineDash([]);
            ctx.strokeRect(x1, y1, width, height);
            
            // 선택된 경우 추가 강조
            if (isFocused) {
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x1 + 2, y1 + 2, width - 4, height - 4);
                ctx.setLineDash([]);
            }
            
            // 라벨
            const label = `${ann.type?.toUpperCase() || 'N/A'}${ann.key_id ? ':' + ann.key_id : ''}`;
            ctx.font = isFocused ? 'bold 14px sans-serif' : '12px sans-serif';
            const textWidth = ctx.measureText(label).width;
            
            ctx.fillStyle = color;
            ctx.fillRect(x1, y1 - 18, textWidth + 8, 18);
            ctx.fillStyle = '#fff';
            ctx.fillText(label, x1 + 4, y1 - 5);
            
            // 크기조정 모드면 핸들 표시
            if (state.resizeTarget === ann.id) {
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                
                const handles = [
                    { x: x1, y: y1, id: 'tl' },
                    { x: x2, y: y1, id: 'tr' },
                    { x: x1, y: y2, id: 'bl' },
                    { x: x2, y: y2, id: 'br' }
                ];
                
                handles.forEach(h => {
                    ctx.fillRect(h.x - HANDLE_SIZE/2, h.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
                    ctx.strokeRect(h.x - HANDLE_SIZE/2, h.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
                });
            }
        });
    }

    // ============================================
    // 어노테이션 리스트
    // ============================================
    function renderAnnotationList() {
        elements.annotationListBody.innerHTML = '';
        
        if (!state.currentJsonData || !state.currentJsonData.annotations) {
            elements.annotationCount.textContent = '0';
            return;
        }
        
        const annotations = state.currentJsonData.annotations;
        elements.annotationCount.textContent = annotations.length;
        
        // KEY 기준으로 그룹화
        const keys = annotations.filter(a => a.type === 'key');
        const values = annotations.filter(a => a.type === 'value');
        const etcs = annotations.filter(a => a.type === 'etc');
        
        keys.forEach(key => {
            // KEY 항목
            const keyItem = createAnnotationItem(key);
            elements.annotationListBody.appendChild(keyItem);
            
            // 연결된 VALUE 항목들 (key_id 타입 통일하여 비교)
            const linkedValues = values.filter(v => String(v.key_id) === String(key.key_id));
            linkedValues.sort((a, b) => (a.order || 1) - (b.order || 1));
            linkedValues.forEach(val => {
                const valItem = createAnnotationItem(val, true);
                elements.annotationListBody.appendChild(valItem);
            });
        });
        
        // ETC 항목들
        etcs.forEach(etc => {
            const etcItem = createAnnotationItem(etc);
            elements.annotationListBody.appendChild(etcItem);
        });
    }

    function createAnnotationItem(ann, isChild = false) {
        const item = document.createElement('div');
        item.className = `annotation-item ${isChild ? 'child-item' : ''} ${ann.type}`;
        item.dataset.id = ann.id;
        
        const typeLabel = ann.type === 'key' ? 'KEY' : ann.type === 'value' ? 'VALUE' : 'ETC';
        const orderLabel = ann.order ? `(${ann.order})` : '';
        const keyIdLabel = ann.key_id ? `#${ann.key_id}` : '';
        
        item.innerHTML = `
            <div class="item-header">
                <span class="type-badge ${ann.type}">${typeLabel}${orderLabel}</span>
                ${keyIdLabel ? `<span class="key-id-badge">${keyIdLabel}</span>` : ''}
            </div>
            <div class="item-text">${(ann.text || '').substring(0, 30)}${(ann.text || '').length > 30 ? '...' : ''}</div>
        `;
        
        item.addEventListener('click', () => selectAnnotation(ann));
        
        return item;
    }

    function selectAnnotation(ann) {
        state.focusedAnnotationId = ann.id;
        
        // 목록에서 선택 표시
        document.querySelectorAll('.annotation-item').forEach(el => {
            el.classList.remove('selected');
            if (el.dataset.id === ann.id) {
                el.classList.add('selected');
            }
        });
        
        // 이미지 확대 및 이동
        if (ann.bbox) {
            focusOnBbox(ann.bbox);
        }
        
        // 팝업 열기
        openEditPopup(ann);
        
        drawBboxes();
    }

    function focusOnBbox(bbox) {
        const [x1, y1, x2, y2] = bbox;
        const bboxWidth = x2 - x1;
        const bboxHeight = y2 - y1;
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        
        // 200% 줌으로 설정
        setZoom(200);
        
        // 스크롤 위치 계산
        const wrapper = elements.canvasWrapper;
        const scale = state.zoom / 100;
        
        const scrollX = centerX * scale - wrapper.clientWidth / 2;
        const scrollY = centerY * scale - wrapper.clientHeight / 2;
        
        wrapper.scrollTo({
            left: Math.max(0, scrollX),
            top: Math.max(0, scrollY),
            behavior: 'smooth'
        });
    }

    // ============================================
    // 줌 컨트롤
    // ============================================
    function adjustZoom(delta) {
        setZoom(state.zoom + delta);
    }

    function setZoom(value) {
        state.zoom = Math.max(25, Math.min(400, value));
        elements.zoomLevel.textContent = state.zoom + '%';
        
        const scale = state.zoom / 100;
        elements.canvasContainer.style.transform = `scale(${scale})`;
        elements.canvasContainer.style.transformOrigin = 'top left';
    }

    // ============================================
    // 캔버스 이벤트 핸들러
    // ============================================
    const HANDLE_SIZE = 8;

    function getMousePos(e) {
        const rect = elements.bboxCanvas.getBoundingClientRect();
        const scale = state.zoom / 100;
        return {
            x: (e.clientX - rect.left) / scale,
            y: (e.clientY - rect.top) / scale
        };
    }

    function findAnnotationAtPoint(x, y) {
        if (!state.currentJsonData || !state.currentJsonData.annotations) return null;
        
        for (const ann of state.currentJsonData.annotations) {
            const [x1, y1, x2, y2] = ann.bbox;
            if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
                return ann;
            }
        }
        return null;
    }

    function getHandleAtPoint(x, y, ann) {
        if (!ann) return null;
        
        const [x1, y1, x2, y2] = ann.bbox;
        const handles = [
            { x: x1, y: y1, id: 'tl' },
            { x: x2, y: y1, id: 'tr' },
            { x: x1, y: y2, id: 'bl' },
            { x: x2, y: y2, id: 'br' }
        ];
        
        for (const h of handles) {
            if (Math.abs(x - h.x) <= HANDLE_SIZE && Math.abs(y - h.y) <= HANDLE_SIZE) {
                return h.id;
            }
        }
        return null;
    }

    function handleCanvasMouseDown(e) {
        const pos = getMousePos(e);
        
        // 크기조정 모드에서 핸들 클릭 확인
        if (state.resizeTarget) {
            const ann = state.currentJsonData.annotations.find(a => a.id === state.resizeTarget);
            if (ann) {
                const handle = getHandleAtPoint(pos.x, pos.y, ann);
                if (handle) {
                    state.isResizing = true;
                    state.resizeHandle = handle;
                    state.resizeOriginalBbox = [...ann.bbox];
                    state.dragStartX = pos.x;
                    state.dragStartY = pos.y;
                    return;
                }
            }
        }
        
        // 일반 클릭: 어노테이션 드래그 시작
        const ann = findAnnotationAtPoint(pos.x, pos.y);
        if (ann) {
            state.isDragging = true;
            state.dragTarget = ann.id;
            state.dragStartX = pos.x;
            state.dragStartY = pos.y;
            state.dragOriginalBbox = [...ann.bbox];
        }
    }

    function handleCanvasMouseMove(e) {
        const pos = getMousePos(e);
        
        // 크기조정 중
        if (state.isResizing && state.resizeTarget) {
            const ann = state.currentJsonData.annotations.find(a => a.id === state.resizeTarget);
            if (!ann) return;
            
            const dx = pos.x - state.dragStartX;
            const dy = pos.y - state.dragStartY;
            const [ox1, oy1, ox2, oy2] = state.resizeOriginalBbox;
            
            let newBbox = [...ann.bbox];
            switch (state.resizeHandle) {
                case 'tl':
                    newBbox[0] = ox1 + dx;
                    newBbox[1] = oy1 + dy;
                    break;
                case 'tr':
                    newBbox[2] = ox2 + dx;
                    newBbox[1] = oy1 + dy;
                    break;
                case 'bl':
                    newBbox[0] = ox1 + dx;
                    newBbox[3] = oy2 + dy;
                    break;
                case 'br':
                    newBbox[2] = ox2 + dx;
                    newBbox[3] = oy2 + dy;
                    break;
            }
            
            // 최소 크기 보장
            if (newBbox[2] - newBbox[0] > 10 && newBbox[3] - newBbox[1] > 10) {
                ann.bbox = newBbox;
                state.isModified = true;
                drawBboxes();
            }
            return;
        }
        
        // 드래그 중
        if (state.isDragging && state.dragTarget) {
            const ann = state.currentJsonData.annotations.find(a => a.id === state.dragTarget);
            if (!ann) return;
            
            const dx = pos.x - state.dragStartX;
            const dy = pos.y - state.dragStartY;
            const [ox1, oy1, ox2, oy2] = state.dragOriginalBbox;
            
            ann.bbox = [ox1 + dx, oy1 + dy, ox2 + dx, oy2 + dy];
            
            // KEY인 경우 연결된 VALUE도 이동
            if (ann.type === 'key') {
                state.currentJsonData.annotations.forEach(other => {
                    if (other.type === 'value' && String(other.key_id) === String(ann.key_id)) {
                        // VALUE의 원래 bbox 저장이 필요하므로, 델타 적용
                        // 간단히 처리: 현재 드래그 시작 시의 델타 적용
                    }
                });
            }
            
            state.isModified = true;
            drawBboxes();
            return;
        }
        
        // 커서 변경
        if (state.resizeTarget) {
            const ann = state.currentJsonData.annotations.find(a => a.id === state.resizeTarget);
            if (ann) {
                const handle = getHandleAtPoint(pos.x, pos.y, ann);
                if (handle) {
                    elements.bboxCanvas.style.cursor = (handle === 'tl' || handle === 'br') ? 'nwse-resize' : 'nesw-resize';
                    return;
                }
            }
        }
        
        const annAtPoint = findAnnotationAtPoint(pos.x, pos.y);
        elements.bboxCanvas.style.cursor = annAtPoint ? 'move' : 'default';
    }

    function handleCanvasMouseUp(e) {
        state.isDragging = false;
        state.isResizing = false;
        state.dragTarget = null;
    }

    function handleCanvasDblClick(e) {
        const pos = getMousePos(e);
        const ann = findAnnotationAtPoint(pos.x, pos.y);
        
        if (ann) {
            // 크기조정 모드 토글
            if (state.resizeTarget === ann.id) {
                state.resizeTarget = null;
            } else {
                state.resizeTarget = ann.id;
            }
            drawBboxes();
        }
    }

    // ============================================
    // 편집 팝업
    // ============================================
    function openEditPopup(ann) {
        state.selectedId = ann.id;
        
        elements.editType.textContent = ann.type?.toUpperCase() || 'N/A';
        elements.editText.value = ann.text || '';
        
        // KEY/VALUE인 경우 key_id 표시
        if (ann.type === 'key' || ann.type === 'value') {
            elements.keyIdGroup.hidden = false;
            elements.editKeyId.value = ann.key_id || '';
        } else {
            elements.keyIdGroup.hidden = true;
        }
        
        // KEY인 경우 연결된 VALUE 표시
        if (ann.type === 'key') {
            elements.linkedValuesGroup.hidden = false;
            elements.linkedValuesList.innerHTML = '';
            
            const linkedValues = state.currentJsonData.annotations.filter(
                a => a.type === 'value' && String(a.key_id) === String(ann.key_id)
            );
            linkedValues.sort((a, b) => (a.order || 1) - (b.order || 1));
            
            if (linkedValues.length === 0) {
                elements.linkedValuesList.innerHTML = '<div class="no-values">연결된 VALUE 없음</div>';
            } else {
                linkedValues.forEach((val, idx) => {
                    // annotations 배열에서의 인덱스 찾기
                    const annIdx = state.currentJsonData.annotations.indexOf(val);
                    const valueItem = document.createElement('div');
                    valueItem.className = 'linked-value-item';
                    valueItem.innerHTML = `
                        <div class="linked-value-label">value${val.order || idx + 1}</div>
                        <textarea class="linked-value-input" data-ann-idx="${annIdx}" rows="3">${val.text || ''}</textarea>
                    `;
                    elements.linkedValuesList.appendChild(valueItem);
                });
            }
        } else {
            elements.linkedValuesGroup.hidden = true;
        }
        
        elements.editPopup.hidden = false;
    }

    function closeEditPopup() {
        elements.editPopup.hidden = true;
        state.selectedId = null;
        state.focusedAnnotationId = null;
        drawBboxes();
    }

    function saveEdit() {
        if (!state.selectedId || !state.currentJsonData) return;
        
        const ann = state.currentJsonData.annotations.find(a => a.id === state.selectedId);
        if (!ann) return;
        
        const newText = elements.editText.value;
        const newKeyId = elements.editKeyId.value ? parseInt(elements.editKeyId.value) : null;
        
        // KEY의 key_id가 변경되면 연결된 VALUE들도 업데이트
        if (ann.type === 'key' && String(ann.key_id) !== String(newKeyId)) {
            state.currentJsonData.annotations.forEach(other => {
                if (other.type === 'value' && String(other.key_id) === String(ann.key_id)) {
                    other.key_id = newKeyId;
                }
            });
        }
        
        ann.text = newText;
        if (ann.type === 'key' || ann.type === 'value') {
            ann.key_id = newKeyId;
        }
        
        // 연결된 VALUE 텍스트 업데이트
        const valueInputs = elements.linkedValuesList.querySelectorAll('.linked-value-input');
        valueInputs.forEach(input => {
            const annIdx = parseInt(input.dataset.annIdx);
            if (!isNaN(annIdx) && state.currentJsonData.annotations[annIdx]) {
                state.currentJsonData.annotations[annIdx].text = input.value;
            }
        });
        
        state.isModified = true;
        
        closeEditPopup();
        renderAnnotationList();
        drawBboxes();
    }

    // ============================================
    // JSON 다운로드
    // ============================================
    function downloadCurrentJson() {
        if (!state.currentJsonData) return;
        
        const imageFile = state.imageFiles[state.currentIndex];
        const baseName = imageFile.name.replace(/\.(jpg|jpeg|png|gif|bmp|webp)$/i, '');
        
        const blob = new Blob([JSON.stringify(state.currentJsonData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        state.isModified = false;
    }

    // ============================================
    // 초기화 실행
    // ============================================
    document.addEventListener('DOMContentLoaded', init);
})();
