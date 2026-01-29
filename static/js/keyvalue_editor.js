/**
 * Key-Value 수정 뷰어 JavaScript - 경로 입력 방식
 */

(function() {
    'use strict';

    // 상태 관리
    const state = {
        imageFiles: [],       // 이미지 파일명 배열
        jsonFiles: [],        // JSON 파일명 배열
        imageFolderPath: '',
        jsonFolderPath: '',
        saveFolderPath: '',   // 저장 경로
        currentImageFiles: [],   // 뷰어에서 사용 중인 이미지 목록 (일반 또는 TRAIN)
        currentImageFolderPath: '', // 뷰어에서 사용 중인 이미지 폴더 경로
        paddleFolderPath: '', // PaddleOCR 경로 (선택)
        labelFolderPath: '',  // 정답 라벨 경로 (선택, UI 제거됨)
        folderBrowserTarget: '',
        folderBrowserCurrentPath: '',
        folderBrowserParentPath: '',
        folderBrowserSelectedPath: '',
        currentIndex: 0,
        currentJsonData: null,
        currentJsonSource: null, // 현재 JSON이 어디서 로드되었는지 추적 (null: 원본, 'save': 저장경로)
        paddleData: null,     // 현재 이미지에 해당하는 PaddleOCR 결과 (words 배열)
        labelData: null,      // 현재 이미지에 해당하는 정답 라벨 (words 배열)
        showPaddleLayer: true,
        showLabelLayer: true,
        showAnnotationLayer: true,  // 내가 올린 JSON(어노테이션) BBOX 표시
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
        focusedAnnotationId: null,
        // 이미지 전체 드래그 상태
        isPanning: false,
        panStartX: 0,
        panStartY: 0,
        panStartScrollLeft: 0,
        panStartScrollTop: 0,
        isSpacePressed: false  // 스페이스바 눌림 상태
    };

    // DOM 요소
    const elements = {
        // 폴더 경로 입력
        imageFolderPath: document.getElementById('imageFolderPath'),
        jsonFolderPath: document.getElementById('jsonFolderPath'),
        saveFolderPath: document.getElementById('saveFolderPath'),
        checkImageFolder: document.getElementById('checkImageFolder'),
        checkJsonFolder: document.getElementById('checkJsonFolder'),
        checkSaveFolder: document.getElementById('checkSaveFolder'),
        imageFolderStatus: document.getElementById('imageFolderStatus'),
        jsonFolderStatus: document.getElementById('jsonFolderStatus'),
        saveFolderStatus: document.getElementById('saveFolderStatus'),
        imageFolderInfo: document.getElementById('imageFolderInfo'),
        jsonFolderInfo: document.getElementById('jsonFolderInfo'),
        saveFolderInfo: document.getElementById('saveFolderInfo'),
        startTrainViewer: document.getElementById('startTrainViewer'),
        paddleFolderPath: document.getElementById('paddleFolderPath'),
        labelFolderPath: document.getElementById('labelFolderPath'),
        checkPaddleFolder: document.getElementById('checkPaddleFolder'),
        checkLabelFolder: document.getElementById('checkLabelFolder'),
        paddleFolderStatus: document.getElementById('paddleFolderStatus'),
        labelFolderStatus: document.getElementById('labelFolderStatus'),
        paddleFolderInfo: document.getElementById('paddleFolderInfo'),
        labelFolderInfo: document.getElementById('labelFolderInfo'),
        startViewer: document.getElementById('startViewer'),
        
        // 뷰어 (레이어 토글)
        showPaddleLayer: document.getElementById('showPaddleLayer'),
        showLabelLayer: document.getElementById('showLabelLayer'),
        showAnnotationLayer: document.getElementById('showAnnotationLayer'),
        
        // 뷰어
        viewerSection: document.getElementById('viewerSection'),
        currentFileName: document.getElementById('currentFileName'),
        fileCounter: document.getElementById('fileCounter'),
        prevBtn: document.getElementById('prevBtn'),
        nextBtn: document.getElementById('nextBtn'),
        saveBtn: document.getElementById('saveBtn'),
        passBtn: document.getElementById('passBtn'),
        
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
        addKeyBtn: document.getElementById('addKeyBtn'),
        addEtcBtn: document.getElementById('addEtcBtn'),
        
        // 편집 팝업
        editPopup: document.getElementById('editPopup'),
        popupClose: document.getElementById('popupClose'),
        editType: document.getElementById('editType'),
        keyIdGroup: document.getElementById('keyIdGroup'),
        editKeyId: document.getElementById('editKeyId'),
        orderGroup: document.getElementById('orderGroup'),
        editOrder: document.getElementById('editOrder'),
        editText: document.getElementById('editText'),
        linkedValuesGroup: document.getElementById('linkedValuesGroup'),
        linkedValuesList: document.getElementById('linkedValuesList'),
        addValueBtn: document.getElementById('addValueBtn'),
        cancelEdit: document.getElementById('cancelEdit'),
        saveEdit: document.getElementById('saveEdit'),
        
        // 폴더 브라우저
        folderBrowserModal: document.getElementById('folderBrowserModal'),
        folderBrowserClose: document.getElementById('folderBrowserClose'),
        folderBrowserCancel: document.getElementById('folderBrowserCancel'),
        folderBrowserSelect: document.getElementById('folderBrowserSelect'),
        folderBrowserUp: document.getElementById('folderBrowserUp'),
        folderBrowserPath: document.getElementById('folderBrowserPath'),
        folderBrowserList: document.getElementById('folderBrowserList')
    };

    // 초기화
    function init() {
        setupEventListeners();
    }

    function setupEventListeners() {
        // 폴더 경로 입력
        if (elements.imageFolderPath && window.DEFAULT_DATA_PATH) {
            elements.imageFolderPath.value = window.DEFAULT_DATA_PATH;
        }
        if (elements.jsonFolderPath && window.DEFAULT_DATA_PATH) {
            elements.jsonFolderPath.value = window.DEFAULT_DATA_PATH;
        }
        elements.checkImageFolder.addEventListener('click', () => checkFolder('image'));
        elements.checkJsonFolder.addEventListener('click', () => checkFolder('json'));
        elements.checkSaveFolder.addEventListener('click', () => checkFolder('save'));
        if (elements.checkPaddleFolder) elements.checkPaddleFolder.addEventListener('click', () => checkFolder('paddle'));
        if (elements.checkLabelFolder) elements.checkLabelFolder.addEventListener('click', () => checkFolder('label'));
        
        elements.startViewer.addEventListener('click', startViewer);
        if (elements.startTrainViewer) elements.startTrainViewer.addEventListener('click', startTrainViewer);
        
        if (elements.showPaddleLayer) elements.showPaddleLayer.addEventListener('change', () => { state.showPaddleLayer = elements.showPaddleLayer.checked; drawBboxes(); });
        if (elements.showLabelLayer) elements.showLabelLayer.addEventListener('change', () => { state.showLabelLayer = elements.showLabelLayer.checked; drawBboxes(); });
        if (elements.showAnnotationLayer) elements.showAnnotationLayer.addEventListener('change', () => { state.showAnnotationLayer = elements.showAnnotationLayer.checked; drawBboxes(); });
        
        // 네비게이션
        elements.prevBtn.addEventListener('click', () => navigateImage(-1));
        elements.nextBtn.addEventListener('click', () => navigateImage(1));
        elements.saveBtn.addEventListener('click', saveCurrentJson);
        elements.passBtn.addEventListener('click', passCurrentFile);
        
        // 방향키 이동/네비게이션
        document.addEventListener('keydown', (e) => {
            if (elements.viewerSection.hidden || !elements.editPopup.hidden) return;
            if (isTypingContext(e.target)) return;
            
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (e.altKey || e.shiftKey) {
                    // Alt 또는 Shift + 왼쪽: 이미지 이전으로 이동
                    navigateImage(-1);
                } else {
                    // 일반 왼쪽: 이미지 이전으로 이동 (수정뷰어)
                    navigateImage(-1);
                }
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (e.altKey || e.shiftKey) {
                    // Alt 또는 Shift + 오른쪽: 이미지 다음으로 이동
                    navigateImage(1);
                } else {
                    // 일반 오른쪽: 이미지 다음으로 이동 (수정뷰어)
                    navigateImage(1);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                // 위쪽: 스크롤 위로
                panCanvas(0, -1, e.shiftKey);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                // 아래쪽: 스크롤 아래로
                panCanvas(0, 1, e.shiftKey);
            } else if (e.key === 'Delete' || e.key === 'Del') {
                e.preventDefault();
                deleteSelectedAnnotation();
            } else if (e.key === ' ') {
                // 스페이스바: 이미지 드래그 모드 활성화
                e.preventDefault();
                state.isSpacePressed = true;
                if (elements.canvasWrapper) {
                    elements.canvasWrapper.style.cursor = 'grab';
                }
            }
        });
        
        // 키 업 이벤트
        document.addEventListener('keyup', (e) => {
            if (e.key === ' ') {
                state.isSpacePressed = false;
                if (elements.canvasWrapper && !state.isPanning) {
                    elements.canvasWrapper.style.cursor = 'default';
                }
            }
        });
        
        // 뷰어 컨트롤 (줌 버튼 숨김)
        if (elements.zoomIn) elements.zoomIn.style.display = 'none';
        if (elements.zoomOut) elements.zoomOut.style.display = 'none';
        if (elements.zoomReset) {
            elements.zoomReset.addEventListener('click', () => setZoom(100));
        }
        
        // 마우스 휠로 줌
        if (elements.canvasWrapper) {
            elements.canvasWrapper.addEventListener('wheel', handleWheelZoom, { passive: false });
        }
        
        // 이미지 전체 드래그 (canvasWrapper에서)
        if (elements.canvasWrapper) {
            elements.canvasWrapper.addEventListener('mousedown', handleWrapperMouseDown);
            elements.canvasWrapper.addEventListener('mousemove', handleWrapperMouseMove);
            elements.canvasWrapper.addEventListener('mouseup', handleWrapperMouseUp);
            elements.canvasWrapper.addEventListener('mouseleave', handleWrapperMouseUp);
            // 우클릭 컨텍스트 메뉴 방지
            elements.canvasWrapper.addEventListener('contextmenu', (e) => {
                if (state.isPanning) {
                    e.preventDefault();
                }
            });
        }
        
        // 캔버스에서도 우클릭 컨텍스트 메뉴 방지 (드래그 중일 때)
        elements.bboxCanvas.addEventListener('contextmenu', (e) => {
            if (state.isPanning) {
                e.preventDefault();
            }
        });
        
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
        if (elements.addValueBtn) {
            elements.addValueBtn.addEventListener('click', () => {
                if (!state.selectedId || !state.currentJsonData) return;
                const keyAnn = state.currentJsonData.annotations.find(a => a.id === state.selectedId);
                if (!keyAnn || keyAnn.type !== 'key') return;
                addLinkedValueForKey(keyAnn);
            });
        }
        elements.editKeyId.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
        elements.editOrder.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });

        // 폴더 브라우저
        if (elements.folderBrowserClose) {
            elements.folderBrowserClose.addEventListener('click', closeFolderBrowser);
        }
        if (elements.folderBrowserCancel) {
            elements.folderBrowserCancel.addEventListener('click', closeFolderBrowser);
        }
        if (elements.folderBrowserSelect) {
            elements.folderBrowserSelect.addEventListener('click', confirmFolderSelection);
        }
        if (elements.folderBrowserUp) {
            elements.folderBrowserUp.addEventListener('click', navigateFolderUp);
        }
        
        // KEY/ETC 추가 버튼
        if (elements.addKeyBtn) {
            elements.addKeyBtn.addEventListener('click', () => addNewAnnotation('key'));
        }
        if (elements.addEtcBtn) {
            elements.addEtcBtn.addEventListener('click', () => addNewAnnotation('etc'));
        }
        
        // ESC로 팝업 닫기
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !elements.editPopup.hidden) {
                closeEditPopup();
            }
        });
    }

    // ============================================
    // 폴더 경로 핸들러
    // ============================================
    async function checkFolder(type) {
        const isImage = type === 'image';
        const isSave = type === 'save';
        const isPaddle = type === 'paddle';
        const isLabel = type === 'label';
        let inputEl, statusEl, infoEl;
        
        if (isImage) {
            inputEl = elements.imageFolderPath;
            statusEl = elements.imageFolderStatus;
            infoEl = elements.imageFolderInfo;
        } else if (isSave) {
            inputEl = elements.saveFolderPath;
            statusEl = elements.saveFolderStatus;
            infoEl = elements.saveFolderInfo;
        } else if (isPaddle) {
            inputEl = elements.paddleFolderPath;
            statusEl = elements.paddleFolderStatus;
            infoEl = elements.paddleFolderInfo;
        } else if (isLabel) {
            inputEl = elements.labelFolderPath;
            statusEl = elements.labelFolderStatus;
            infoEl = elements.labelFolderInfo;
        } else {
            inputEl = elements.jsonFolderPath;
            statusEl = elements.jsonFolderStatus;
            infoEl = elements.jsonFolderInfo;
        }
        
        const folderPath = (inputEl && inputEl.value) ? inputEl.value.trim() : '';
        
        if (!folderPath) {
            if (infoEl) infoEl.textContent = isPaddle || isLabel ? '경로를 입력 후 확인하세요' : '❌ 폴더 경로를 입력하세요';
            if (statusEl) statusEl.textContent = isPaddle || isLabel ? '미입력' : '미선택';
            if (statusEl) statusEl.className = 'status-badge status-error';
            if (isSave) {
                state.saveFolderPath = '';
            } else if (isPaddle) {
                state.paddleFolderPath = '';
            } else if (isLabel) {
                state.labelFolderPath = '';
            }
            if (!isSave) updateStartButton();
            return;
        }
        
        try {
            // PaddleOCR / 정답 라벨 경로 (선택): 폴더만 확인
            if (isPaddle || isLabel) {
                const response = await fetch('/editor/check-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath: folderPath, fileType: 'json' })
                });
                const result = await response.json();
                if (!response.ok || !result.success) {
                    throw new Error(result.error || '폴더 확인 실패');
                }
                if (isPaddle) {
                    state.paddleFolderPath = result.path;
                    if (elements.paddleFolderPath) elements.paddleFolderPath.value = result.path;
                } else {
                    state.labelFolderPath = result.path;
                    if (elements.labelFolderPath) elements.labelFolderPath.value = result.path;
                }
                if (infoEl) infoEl.textContent = '✅ ' + (result.count || 0) + '개 JSON 파일';
                if (statusEl) { statusEl.textContent = '선택됨'; statusEl.className = 'status-badge status-success'; }
                return;
            }
            // 저장 경로는 폴더만 확인 (파일 목록 불필요, 없으면 생성)
            if (isSave) {
                const response = await fetch('/editor/check-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        folderPath: folderPath,
                        fileType: 'json',  // 파일 타입은 상관없지만 API 호환성을 위해
                        createIfNotExists: true  // 폴더가 없으면 생성
                    })
                });
                
                const result = await response.json();
                if (!response.ok || !result.success) {
                    throw new Error(result.error || '폴더 확인 실패');
                }
                
                state.saveFolderPath = result.path;
                elements.saveFolderPath.value = result.path;
                infoEl.textContent = '✅ 저장 경로 확인됨';
                statusEl.textContent = '선택됨';
                statusEl.className = 'status-badge status-success';
                
                // 이미지 폴더와 JSON 폴더가 이미 설정되어 있으면 목록 다시 필터링
                if (state.imageFolderPath && state.imageFiles.length > 0) {
                    checkFolder('image');
                }
                if (state.jsonFolderPath && state.jsonFiles.length > 0) {
                    checkFolder('json');
                }
            } else {
                // 이미지 폴더 확인 시 저장 경로도 함께 전달 (존재하는 이미지만 필터링)
                // JSON 폴더 확인 시 이미지 폴더와 저장 경로도 함께 전달 (이미지가 존재하는 JSON만 필터링)
                const requestBody = {
                    folderPath: folderPath,
                    fileType: isImage ? 'image' : 'json'
                };
                if (isImage) {
                    const savePath = state.saveFolderPath || state.jsonFolderPath;
                    if (savePath) {
                        requestBody.saveFolder = savePath;
                    }
                } else {
                    // JSON 폴더 확인 시 이미지 폴더와 저장 경로 전달
                    if (state.imageFolderPath) {
                        requestBody.imageFolder = state.imageFolderPath;
                    }
                    const savePath = state.saveFolderPath || state.jsonFolderPath;
                    if (savePath) {
                        requestBody.saveFolder = savePath;
                    }
                }
                
                const response = await fetch('/editor/check-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });
                
                const result = await response.json();
                if (!response.ok || !result.success) {
                    throw new Error(result.error || '폴더 확인 실패');
                }
                
                if (isImage) {
                    state.imageFiles = result.files || [];
                    state.imageFolderPath = result.path;
                    elements.imageFolderPath.value = result.path;
                } else {
                    state.jsonFiles = result.files || [];
                    state.jsonFolderPath = result.path;
                    elements.jsonFolderPath.value = result.path;
                }
                
                infoEl.textContent = `✅ ${result.count}개 파일 확인됨`;
                statusEl.textContent = '선택됨';
                statusEl.className = 'status-badge status-success';
                updateStartButton();
            }
        } catch (err) {
            infoEl.textContent = `❌ ${err.message}`;
            statusEl.textContent = '미선택';
            statusEl.className = 'status-badge status-error';
            if (isSave) {
                state.saveFolderPath = '';
            } else if (isImage) {
                state.imageFiles = [];
            } else {
                state.jsonFiles = [];
            }
            if (!isSave) {
                updateStartButton();
            }
        }
    }
    
    function updateStartButton() {
        const ready = state.imageFiles.length > 0;
        elements.startViewer.disabled = !ready;
    }
    
    function isTypingContext(target) {
        if (!target) return false;
        const tag = target.tagName ? target.tagName.toLowerCase() : '';
        return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    }
    
    function panCanvas(dx, dy, isFast) {
        const wrapper = elements.canvasWrapper;
        if (!wrapper) return;
        const step = isFast ? 120 : 40;
        wrapper.scrollBy({
            left: dx * step,
            top: dy * step,
            behavior: 'auto'
        });
    }
    
    // ============================================
    // 폴더 브라우저
    // ============================================
    function openFolderBrowser(type) {
        state.folderBrowserTarget = type;
        state.folderBrowserSelectedPath = '';
        const currentPath = (type === 'image' ? elements.imageFolderPath.value : elements.jsonFolderPath.value) || window.DEFAULT_DATA_PATH || '/';
        loadFolderList(currentPath);
        elements.folderBrowserModal.hidden = false;
    }
    
    function closeFolderBrowser() {
        elements.folderBrowserModal.hidden = true;
    }
    
    async function loadFolderList(path) {
        elements.folderBrowserList.classList.add('loading');
        elements.folderBrowserList.innerHTML = '';
        try {
            const response = await fetch('/batch/browse-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '폴더 목록을 가져올 수 없습니다.');
            }
            
            state.folderBrowserCurrentPath = result.currentPath;
            state.folderBrowserParentPath = result.parentPath;
            elements.folderBrowserPath.textContent = result.currentPath;
            elements.folderBrowserUp.disabled = !result.parentPath;
            elements.folderBrowserList.classList.remove('loading');
            
            if (!result.items || result.items.length === 0) {
                elements.folderBrowserList.innerHTML = '<div class="folder-empty">빈 폴더</div>';
                return;
            }
            
            result.items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'folder-item';
                row.dataset.path = item.path;
                row.innerHTML = `
                    <span class="folder-item-icon">📁</span>
                    <span class="folder-item-name">${item.name}</span>
                `;
                row.addEventListener('click', () => selectFolderItem(row));
                row.addEventListener('dblclick', () => loadFolderList(item.path));
                elements.folderBrowserList.appendChild(row);
            });
        } catch (err) {
            elements.folderBrowserList.classList.remove('loading');
            elements.folderBrowserList.innerHTML = `<div class="folder-empty">오류: ${err.message}</div>`;
        }
    }
    
    function selectFolderItem(row) {
        const rows = elements.folderBrowserList.querySelectorAll('.folder-item');
        rows.forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        state.folderBrowserSelectedPath = row.dataset.path;
    }
    
    function navigateFolderUp() {
        if (state.folderBrowserParentPath) {
            loadFolderList(state.folderBrowserParentPath);
        }
    }
    
    function confirmFolderSelection() {
        const selected = state.folderBrowserSelectedPath || state.folderBrowserCurrentPath;
        if (!selected) return;
        if (state.folderBrowserTarget === 'image') {
            elements.imageFolderPath.value = selected;
            checkFolder('image');
        } else {
            elements.jsonFolderPath.value = selected;
            checkFolder('json');
        }
        closeFolderBrowser();
    }

    // ============================================
    // 뷰어 시작
    // ============================================
    function startViewer() {
        if (state.imageFiles.length === 0) return;
        
        state.currentImageFiles = state.imageFiles.slice();
        state.currentImageFolderPath = state.imageFolderPath;
        applyViewerLayerState();
        elements.viewerSection.hidden = false;
        state.currentIndex = 0;
        loadCurrentFile();
    }

    /** 저장 경로의 이미지로 TRAIN 뷰어 열기 */
    async function startTrainViewer() {
        const savePath = (elements.saveFolderPath && elements.saveFolderPath.value) ? elements.saveFolderPath.value.trim() : (state.saveFolderPath || '').trim();
        if (!savePath) {
            alert('저장 경로를 입력한 뒤 확인을 눌러 주세요.');
            return;
        }
        try {
            const response = await fetch('/editor/check-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath: savePath, fileType: 'image' })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                alert(result.error || '폴더를 확인할 수 없습니다.');
                return;
            }
            const files = result.files || [];
            if (files.length === 0) {
                alert('저장 경로에 이미지 파일이 없습니다.');
                return;
            }
            state.currentImageFiles = files.slice();
            state.currentImageFolderPath = result.path;
            applyViewerLayerState();
            elements.viewerSection.hidden = false;
            state.currentIndex = 0;
            loadCurrentFile();
        } catch (err) {
            alert('폴더 확인 실패: ' + (err.message || err));
        }
    }

    function applyViewerLayerState() {
        if (elements.paddleFolderPath) state.paddleFolderPath = (elements.paddleFolderPath.value || '').trim();
        if (elements.labelFolderPath) state.labelFolderPath = (elements.labelFolderPath.value || '').trim();
        state.showPaddleLayer = elements.showPaddleLayer ? elements.showPaddleLayer.checked : true;
        state.showLabelLayer = elements.showLabelLayer ? elements.showLabelLayer.checked : true;
        state.showAnnotationLayer = elements.showAnnotationLayer ? elements.showAnnotationLayer.checked : true;
        if (elements.showPaddleLayer) {
            elements.showPaddleLayer.disabled = !state.paddleFolderPath;
            if (!state.paddleFolderPath) { elements.showPaddleLayer.checked = false; state.showPaddleLayer = false; }
        }
        if (elements.showLabelLayer) {
            elements.showLabelLayer.disabled = !state.labelFolderPath;
            if (!state.labelFolderPath) { elements.showLabelLayer.checked = false; state.showLabelLayer = false; }
        }
    }
    
    function loadCurrentFile() {
        if (!state.currentImageFiles || state.currentImageFiles.length === 0) return;
        
        const imageFile = state.currentImageFiles[state.currentIndex];
        const baseName = imageFile.replace(/\.(jpg|jpeg|png|gif|bmp|webp|tiff)$/i, '');
        const jsonFile = baseName + '.json';
        
        const savePath = state.saveFolderPath || state.jsonFolderPath;
        
        const imageUrl = `/editor/load-image?folder=${encodeURIComponent(state.currentImageFolderPath)}&file=${encodeURIComponent(imageFile)}${savePath ? '&saveFolder=' + encodeURIComponent(savePath) : ''}`;
        elements.viewerImage.src = imageUrl;
        
        elements.viewerImage.onload = async () => {
            const img = elements.viewerImage;
            elements.bboxCanvas.width = img.naturalWidth;
            elements.bboxCanvas.height = img.naturalHeight;
            elements.canvasContainer.style.width = img.naturalWidth + 'px';
            elements.canvasContainer.style.height = img.naturalHeight + 'px';
            
            // JSON 파일 로드 (이미지 파일명과 동일한 이름의 JSON 파일을 JSON 폴더에서 찾기)
            if (state.jsonFolderPath) {
                state.currentJsonSource = null;
                state.currentJsonData = await loadJsonData(jsonFile);
            } else {
                state.currentJsonSource = null;
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
            
            // PaddleOCR / 정답 라벨 JSON 로드 (경로가 있을 때만, 선택 사항)
            state.paddleData = null;
            state.labelData = null;
            if (state.paddleFolderPath) {
                const raw = await loadJsonFromFolder(state.paddleFolderPath, jsonFile);
                if (raw) state.paddleData = parsePaddleOCR(raw);
            }
            if (state.labelFolderPath) {
                const raw = await loadJsonFromFolder(state.labelFolderPath, jsonFile);
                if (raw) state.labelData = parseLabelOCR(raw);
            }
            
            drawBboxes();
            renderAnnotationList();
        };
        
        elements.viewerImage.onerror = () => {
            console.error('이미지 로드 실패:', imageFile);
            alert(`이미지를 로드할 수 없습니다: ${imageFile}`);
        };
        
        elements.currentFileName.textContent = imageFile;
        elements.fileCounter.textContent = `${state.currentIndex + 1} / ${state.currentImageFiles.length}`;
        elements.prevBtn.disabled = state.currentIndex === 0;
        elements.nextBtn.disabled = state.currentIndex === state.currentImageFiles.length - 1;
        
        state.focusedAnnotationId = null;
    }

    async function loadJsonData(filename) {
        // 이미지 파일명과 동일한 이름의 JSON 파일을 JSON 폴더에서 찾기
        if (!state.jsonFolderPath) {
            return { annotations: [] };
        }
        
        try {
            const requestBody = {
                folderPath: state.jsonFolderPath,
                filename: filename
            };
            
            // 저장 경로가 있으면 저장 경로에서도 확인
            if (state.saveFolderPath) {
                requestBody.saveFolder = state.saveFolderPath;
            }
            
            const response = await fetch('/editor/load-json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                return { annotations: [] };
            }
            return result.data || { annotations: [] };
        } catch (err) {
            console.error('JSON 로드 실패:', err);
            return { annotations: [] };
        }
    }

    /** 지정 폴더에서 JSON 파일 로드 (PaddleOCR/정답 라벨용). 없으면 null */
    async function loadJsonFromFolder(folderPath, filename) {
        if (!folderPath || !filename) return null;
        try {
            const response = await fetch('/editor/load-json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath: folderPath, filename: filename })
            });
            const result = await response.json();
            if (!response.ok || !result.success) return null;
            return result.data || null;
        } catch (err) {
            return null;
        }
    }

    /** PaddleOCR JSON → { bbox, text }[] (여러 출력 형식 지원) */
    function parsePaddleOCR(data) {
        const words = [];
        if (!data) return words;
        // 형식 A: 최상위 배열 [ { "bbox": [x1,y1,x2,y2], "text": "..." }, ... ] (PaddleOCR 일반 출력)
        if (Array.isArray(data)) {
            for (const item of data) {
                const bbox = normalizeBbox(item.bbox);
                if (bbox) words.push({ bbox, text: String(item.text != null ? item.text : '') });
            }
            return words;
        }
        // 형식 B: { annotations: [ { bbox, text } ] }
        if (data.annotations && Array.isArray(data.annotations)) {
            for (const ann of data.annotations) {
                const bbox = normalizeBbox(ann.bbox);
                if (bbox && (ann.text != null)) words.push({ bbox, text: String(ann.text) });
            }
            return words;
        }
        // 형식 C: { rec_texts: string[], bbox: number[][] } (병렬 배열)
        if (data.rec_texts && Array.isArray(data.rec_texts) && data.bbox && Array.isArray(data.bbox)) {
            const texts = data.rec_texts;
            const bboxes = data.bbox;
            for (let i = 0; i < Math.min(texts.length, bboxes.length); i++) {
                const bbox = normalizeBbox(bboxes[i]);
                if (bbox) words.push({ bbox, text: String(texts[i] != null ? texts[i] : '') });
            }
            return words;
        }
        // 형식 D: { lines: [ { text, bbox 또는 points } ] }
        if (data.lines && Array.isArray(data.lines)) {
            for (const line of data.lines) {
                const bbox = normalizeBbox(line.bbox || line.points);
                if (bbox) words.push({ bbox, text: String(line.text != null ? line.text : '') });
            }
            return words;
        }
        // 형식 E: { words: [ { bbox, text } ] }
        if (data.words && Array.isArray(data.words)) {
            for (const w of data.words) {
                const bbox = normalizeBbox(w.bbox);
                if (bbox) words.push({ bbox, text: String(w.text != null ? w.text : w.word != null ? w.word : '') });
            }
        }
        return words;
    }

    /** bbox를 [x1, y1, x2, y2]로 통일 (4점 형식 지원) */
    function normalizeBbox(bbox) {
        if (!bbox) return null;
        if (Array.isArray(bbox) && bbox.length >= 4) {
            if (typeof bbox[0] === 'number') return [bbox[0], bbox[1], bbox[2], bbox[3]];
            if (Array.isArray(bbox[0])) {
                const xs = bbox.map(p => p[0]);
                const ys = bbox.map(p => p[1]);
                return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
            }
        }
        return null;
    }

    /** 정답 라벨 JSON → { bbox, text }[] (물류 OCR/라벨 형식 지원) */
    function parseLabelOCR(data) {
        const words = [];
        if (!data) return words;
        if (data.bbox && Array.isArray(data.bbox) && data.bbox.length > 0 && data.bbox[0].x) {
            for (const item of data.bbox) {
                if (item.x && item.y && (item.data || item.text)) {
                    const xs = item.x, ys = item.y;
                    words.push({
                        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
                        text: item.data || item.text || ''
                    });
                }
            }
            return words;
        }
        if (data.words && Array.isArray(data.words)) {
            return data.words.filter(w => w.bbox && w.text);
        }
        const items = Array.isArray(data) ? data : (data.items || data.data || []);
        for (const item of items) {
            if (item.x && item.y && (item.data || item.text)) {
                const x = item.x, y = item.y;
                words.push({
                    bbox: [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)],
                    text: item.data || item.text || ''
                });
            } else if (item.bbox && item.text) {
                words.push({ bbox: item.bbox, text: item.text });
            }
        }
        return words;
    }


    function navigateImage(delta) {
        const newIndex = state.currentIndex + delta;
        if (newIndex < 0 || newIndex >= state.currentImageFiles.length) return;
        
        state.currentIndex = newIndex;
        loadCurrentFile();
    }

    function passCurrentFile() {
        if (state.currentImageFiles.length === 0) return;
        
        const currentImageFile = state.currentImageFiles[state.currentIndex];
        
        state.currentImageFiles = state.currentImageFiles.filter(f => f !== currentImageFile);
        
        if (state.currentImageFiles.length === 0) {
            alert('모든 파일을 처리했습니다.');
            document.querySelector('.path-section').hidden = false;
            elements.viewerSection.hidden = true;
            return;
        }
        
        if (state.currentIndex >= state.currentImageFiles.length) {
            state.currentIndex = state.currentImageFiles.length - 1;
        }
        
        loadCurrentFile();
    }

    async function saveAndNavigate(delta) {
        // 저장 경로가 설정되어 있으면 항상 저장
        if (state.saveFolderPath || state.jsonFolderPath) {
            try {
                await saveCurrentJson();
                console.log('저장 완료: KEY_ID 재정렬됨');
            } catch (err) {
                // 저장 실패 시 사용자에게 알림
                console.error('저장 실패:', err);
                const shouldContinue = confirm(`저장에 실패했습니다.\n${err.message}\n\n그래도 다음으로 이동하시겠습니까?`);
                if (!shouldContinue) {
                    return; // 사용자가 취소하면 이동하지 않음
                }
            }
        }
        navigateImage(delta);
    }

    // ============================================
    // Bbox 그리기
    // ============================================
    function drawBboxes() {
        const canvas = elements.bboxCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const HANDLE_SIZE = 8;
        
        // 1) PaddleOCR 레이어 (선택 시에만)
        if (state.showPaddleLayer && state.paddleData && state.paddleData.length > 0) {
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            state.paddleData.forEach(w => {
                if (!w.bbox || w.bbox.length < 4) return;
                const [x1, y1, x2, y2] = w.bbox;
                ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            });
            ctx.setLineDash([]);
        }
        
        // 2) 정답 라벨 레이어 (선택 시에만)
        if (state.showLabelLayer && state.labelData && state.labelData.length > 0) {
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            state.labelData.forEach(w => {
                if (!w.bbox || w.bbox.length < 4) return;
                const [x1, y1, x2, y2] = w.bbox;
                ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            });
            ctx.setLineDash([]);
        }
        
        // 3) JSON(어노테이션) BBOX 레이어 (선택 시에만)
        if (state.showAnnotationLayer && state.currentJsonData && state.currentJsonData.annotations) {
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
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.strokeRect(x1, y1, width, height);
            
            // 선택된 경우 추가 강조
            if (isFocused) {
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x1 + 1, y1 + 1, width - 2, height - 2);
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
            
            // 선택된 박스는 핸들 표시
            if (state.focusedAnnotationId === ann.id) {
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                
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
        
        // KEY 기준으로 그룹화 (KEY_ID 순서대로 정렬)
        const keys = annotations.filter(a => a.type === 'key');
        const values = annotations.filter(a => a.type === 'value');
        const etcs = annotations.filter(a => a.type === 'etc');
        
        // KEY를 key_id 순서대로 정렬
        keys.sort((a, b) => {
            const aId = a.key_id || 0;
            const bId = b.key_id || 0;
            return aId - bId;
        });
        
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
        // 우클릭 또는 스페이스바 + 왼쪽 클릭: 이미지 드래그
        if (e.button === 2 || (e.button === 0 && state.isSpacePressed)) {
            e.preventDefault();
            state.isPanning = true;
            state.panStartX = e.clientX;
            state.panStartY = e.clientY;
            state.panStartScrollLeft = elements.canvasWrapper.scrollLeft;
            state.panStartScrollTop = elements.canvasWrapper.scrollTop;
            elements.canvasWrapper.style.cursor = 'grabbing';
            return;
        }
        
        // 왼쪽 클릭: 어노테이션 편집
        if (e.button !== 0) return;
        
        const pos = getMousePos(e);
        
        const ann = findAnnotationAtPoint(pos.x, pos.y);
        if (ann) {
            // 어노테이션을 클릭한 경우
            state.focusedAnnotationId = ann.id;
            const handle = getHandleAtPoint(pos.x, pos.y, ann);
            if (handle) {
                state.isResizing = true;
                state.resizeTarget = ann.id;
                state.resizeHandle = handle;
                state.resizeOriginalBbox = [...ann.bbox];
                state.dragStartX = pos.x;
                state.dragStartY = pos.y;
            } else {
                state.isDragging = true;
                state.dragTarget = ann.id;
                state.dragStartX = pos.x;
                state.dragStartY = pos.y;
                state.dragOriginalBbox = [...ann.bbox];
            }
            drawBboxes();
        }
    }

    function handleCanvasMouseMove(e) {
        // 이미지 드래그 중이면 canvasWrapper의 드래그 핸들러로 처리
        if (state.isPanning) {
            handleWrapperMouseMove(e);
            return;
        }
        
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
        
        // 커서 변경 (핸들 우선)
        if (state.isPanning) {
            elements.canvasWrapper.style.cursor = 'grabbing';
            return;
        }
        
        // 스페이스바가 눌려있으면 grab 커서
        if (state.isSpacePressed) {
            elements.canvasWrapper.style.cursor = 'grab';
            return;
        }
        
        const annAtPoint = findAnnotationAtPoint(pos.x, pos.y);
        if (annAtPoint) {
            const handle = getHandleAtPoint(pos.x, pos.y, annAtPoint);
            if (handle) {
                elements.bboxCanvas.style.cursor = (handle === 'tl' || handle === 'br') ? 'nwse-resize' : 'nesw-resize';
            } else {
                elements.bboxCanvas.style.cursor = 'move';
            }
        } else {
            elements.bboxCanvas.style.cursor = 'default';
        }
    }

    function handleCanvasMouseUp(e) {
        // 이미지 드래그 종료
        if (state.isPanning) {
            handleWrapperMouseUp(e);
        }
        
        state.isDragging = false;
        state.isResizing = false;
        state.dragTarget = null;
        state.resizeTarget = null;
        state.resizeHandle = null;
    }

    // ============================================
    // 마우스 휠 줌
    // ============================================
    function handleWheelZoom(e) {
        if (elements.viewerSection.hidden) return;
        
        // Ctrl 키를 누르고 있으면 줌, 아니면 스크롤
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -10 : 10;
            adjustZoom(delta);
        }
    }

    // ============================================
    // 이미지 전체 드래그 (canvasWrapper)
    // ============================================
    function handleWrapperMouseDown(e) {
        // 어노테이션 편집 중이거나 팝업이 열려있으면 무시
        if (!elements.editPopup.hidden) return;
        
        // 우클릭 또는 스페이스바 + 왼쪽 클릭: 이미지 드래그
        if (e.button === 2 || (e.button === 0 && state.isSpacePressed)) {
            // bboxCanvas가 아닌 빈 공간을 클릭한 경우에만 드래그 시작
            if (e.target !== elements.bboxCanvas && (e.target === elements.canvasWrapper || e.target === elements.canvasContainer || e.target === elements.viewerImage)) {
                state.isPanning = true;
                state.panStartX = e.clientX;
                state.panStartY = e.clientY;
                state.panStartScrollLeft = elements.canvasWrapper.scrollLeft;
                state.panStartScrollTop = elements.canvasWrapper.scrollTop;
                elements.canvasWrapper.style.cursor = 'grabbing';
                e.preventDefault();
            }
        }
    }

    function handleWrapperMouseMove(e) {
        if (!state.isPanning) return;
        
        const dx = e.clientX - state.panStartX;
        const dy = e.clientY - state.panStartY;
        
        elements.canvasWrapper.scrollLeft = state.panStartScrollLeft - dx;
        elements.canvasWrapper.scrollTop = state.panStartScrollTop - dy;
        
        e.preventDefault();
    }

    function handleWrapperMouseUp(e) {
        if (state.isPanning) {
            state.isPanning = false;
            elements.canvasWrapper.style.cursor = 'default';
        }
    }

    function handleCanvasDblClick(e) {
        const pos = getMousePos(e);
        const ann = findAnnotationAtPoint(pos.x, pos.y);
        
        if (ann) {
            state.focusedAnnotationId = ann.id;
            document.querySelectorAll('.annotation-item').forEach(el => {
                el.classList.toggle('selected', el.dataset.id === ann.id);
            });
            drawBboxes();
            openEditPopup(ann);
        }
    }

    function deleteSelectedAnnotation() {
        if (!state.focusedAnnotationId || !state.currentJsonData || !state.currentJsonData.annotations) {
            return;
        }
        
        const ann = state.currentJsonData.annotations.find(a => a.id === state.focusedAnnotationId);
        if (!ann) {
            return;
        }
        
        if (ann.type === 'key') {
            // KEY인 경우: 해당 key_id를 가진 모든 VALUE도 함께 삭제
            const keyId = ann.key_id;
            state.currentJsonData.annotations = state.currentJsonData.annotations.filter(a => {
                // KEY 자체와 같은 key_id를 가진 VALUE 모두 제거
                if (a.id === state.focusedAnnotationId) {
                    return false; // KEY 제거
                }
                if (a.type === 'value' && String(a.key_id) === String(keyId)) {
                    return false; // 연결된 VALUE 제거
                }
                return true;
            });
        } else if (ann.type === 'value') {
            // VALUE인 경우: 해당 VALUE만 제거
            const deletedKeyId = ann.key_id;
            const deletedOrder = ann.order || 1;
            
            state.currentJsonData.annotations = state.currentJsonData.annotations.filter(
                a => a.id !== state.focusedAnnotationId
            );
            
            // 같은 key_id를 가진 나머지 VALUE들의 order 재정렬
            const remainingValues = state.currentJsonData.annotations.filter(
                a => a.type === 'value' && String(a.key_id) === String(deletedKeyId)
            );
            
            // order 기준으로 정렬
            remainingValues.sort((a, b) => (a.order || 1) - (b.order || 1));
            
            // order를 1부터 순차적으로 재할당
            remainingValues.forEach((val, index) => {
                val.order = index + 1;
            });
        } else {
            // ETC 등 다른 타입도 단일 삭제
            state.currentJsonData.annotations = state.currentJsonData.annotations.filter(
                a => a.id !== state.focusedAnnotationId
            );
        }
        
        // 선택 해제
        state.focusedAnnotationId = null;
        state.selectedId = null;
        
        // 수정 표시
        state.isModified = true;
        
        // UI 업데이트
        drawBboxes();
        renderAnnotationList();
        
        // 편집 팝업이 열려있으면 닫기
        if (!elements.editPopup.hidden) {
            closeEditPopup();
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
        
        // VALUE인 경우 order 표시
        if (ann.type === 'value') {
            elements.orderGroup.hidden = false;
            elements.editOrder.value = ann.order || 1;
        } else {
            elements.orderGroup.hidden = true;
        }
        
        // KEY인 경우 연결된 VALUE 표시
        if (ann.type === 'key') {
            elements.linkedValuesGroup.hidden = false;
            elements.linkedValuesList.innerHTML = '';
            if (elements.addValueBtn) {
                elements.addValueBtn.disabled = false;
            }
            
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
            if (elements.addValueBtn) {
                elements.addValueBtn.disabled = true;
            }
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
        
        // KEY의 key_id가 변경되는 경우
        if (ann.type === 'key' && String(ann.key_id) !== String(newKeyId) && newKeyId !== null) {
            const oldKeyId = ann.key_id;
            
            // 같은 key_id를 가진 다른 KEY가 있는지 확인
            const duplicateKey = state.currentJsonData.annotations.find(
                a => a.type === 'key' && a.id !== ann.id && a.key_id === newKeyId
            );
            
            if (duplicateKey) {
                // 중복된 KEY를 다른 번호로 자동 변경 (사용되지 않는 번호 찾기)
                const allKeyIds = new Set();
                state.currentJsonData.annotations.forEach(a => {
                    if (a.type === 'key' && a.key_id !== null && a.key_id !== undefined) {
                        allKeyIds.add(a.key_id);
                    }
                });
                
                // 사용 가능한 번호 찾기
                let availableId = 1;
                while (allKeyIds.has(availableId) || availableId === newKeyId) {
                    availableId++;
                }
                
                const duplicateOldKeyId = duplicateKey.key_id;
                
                // 중복된 KEY의 key_id 변경
                duplicateKey.key_id = availableId;
                
                // 중복된 KEY에 연결된 VALUE들의 key_id도 업데이트
                state.currentJsonData.annotations.forEach(other => {
                    if (other.type === 'value' && String(other.key_id) === String(duplicateOldKeyId)) {
                        other.key_id = availableId;
                    }
                });
                
                console.log(`KEY_ID 중복 해결: 기존 KEY ${duplicateOldKeyId} → ${availableId}로 변경`);
            }
            
            // KEY의 key_id 변경
            ann.key_id = newKeyId;
            
            // 연결된 VALUE들의 key_id도 업데이트
            state.currentJsonData.annotations.forEach(other => {
                if (other.type === 'value' && String(other.key_id) === String(oldKeyId)) {
                    other.key_id = newKeyId;
                }
            });
        }
        
        ann.text = newText;
        // KEY 타입은 위에서 이미 처리했으므로, VALUE 타입만 처리
        if (ann.type === 'value') {
            ann.key_id = newKeyId;
        }
        
        // VALUE인 경우 order 업데이트
        if (ann.type === 'value') {
            const newOrder = elements.editOrder.value ? parseInt(elements.editOrder.value) : 1;
            ann.order = newOrder;
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

    function addLinkedValueForKey(keyAnn) {
        if (!state.currentJsonData || !state.currentJsonData.annotations) return;
        
        const linkedValues = state.currentJsonData.annotations.filter(
            a => a.type === 'value' && String(a.key_id) === String(keyAnn.key_id)
        );
        const maxOrder = linkedValues.reduce((maxVal, v) => Math.max(maxVal, v.order || 1), 0);
        const newOrder = maxOrder + 1;
        
        let newBbox = [0, 0, 100, 30];
        const gap = 8;
        if (linkedValues.length > 0) {
            const lastValue = linkedValues.reduce((best, v) => {
                const bestOrder = best?.order || 1;
                const currOrder = v.order || 1;
                return currOrder >= bestOrder ? v : best;
            }, linkedValues[0]);
            if (lastValue && lastValue.bbox && lastValue.bbox.length === 4) {
                const [vx1, vy1, vx2, vy2] = lastValue.bbox;
                const valueHeight = vy2 - vy1;
                newBbox = [vx1, vy2 + gap, vx2, vy2 + gap + valueHeight];
            }
        } else if (keyAnn.bbox && keyAnn.bbox.length === 4) {
            const [x1, y1, x2, y2] = keyAnn.bbox;
            const keyWidth = x2 - x1;
            const keyHeight = y2 - y1;
            const valueWidth = Math.max(80, Math.round(keyWidth * 2));
            const valueHeight = Math.max(30, Math.round(keyHeight));
            newBbox = [x2 + gap, y1, x2 + gap + valueWidth, y1 + valueHeight];
        }
        
        const newAnn = {
            id: `temp_value_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            type: 'value',
            key_id: keyAnn.key_id,
            text: '',
            bbox: newBbox,
            order: newOrder
        };
        
        state.currentJsonData.annotations.push(newAnn);
        state.isModified = true;
        
        const annIdx = state.currentJsonData.annotations.length - 1;
        const valueItem = document.createElement('div');
        valueItem.className = 'linked-value-item';
        valueItem.innerHTML = `
            <div class="linked-value-label">value${newOrder}</div>
            <textarea class="linked-value-input" data-ann-idx="${annIdx}" rows="3"></textarea>
        `;
        elements.linkedValuesList.appendChild(valueItem);
        const textarea = valueItem.querySelector('textarea');
        if (textarea) textarea.focus();
        
        renderAnnotationList();
        drawBboxes();
    }

    function addNewAnnotation(type) {
        if (!state.currentJsonData || !state.currentJsonData.annotations) {
            return;
        }
        
        if (!elements.viewerImage || !elements.bboxCanvas) {
            return;
        }
        
        const img = elements.viewerImage;
        const canvas = elements.bboxCanvas;
        
        // 이미지가 로드되지 않았으면 리턴
        if (!img.naturalWidth || !img.naturalHeight) {
            alert('이미지를 먼저 로드해주세요.');
            return;
        }
        
        // 기본 BBOX 위치 설정 (이미지 중앙 상단)
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;
        const defaultWidth = Math.min(200, imgWidth * 0.3);
        const defaultHeight = Math.min(40, imgHeight * 0.05);
        const defaultX = Math.max(10, (imgWidth - defaultWidth) / 2);
        const defaultY = Math.max(10, imgHeight * 0.1);
        
        const newBbox = [
            Math.round(defaultX),
            Math.round(defaultY),
            Math.round(defaultX + defaultWidth),
            Math.round(defaultY + defaultHeight)
        ];
        
        let newAnn;
        
        if (type === 'key') {
            // KEY인 경우: 기존 KEY들의 최대 key_id 찾기
            const existingKeys = state.currentJsonData.annotations.filter(a => a.type === 'key');
            const maxKeyId = existingKeys.reduce((max, k) => {
                const keyId = k.key_id || 0;
                return Math.max(max, keyId);
            }, 0);
            const newKeyId = maxKeyId + 1;
            
            newAnn = {
                id: `temp_key_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                type: 'key',
                key_id: newKeyId,
                text: '',
                bbox: newBbox
            };
        } else if (type === 'etc') {
            newAnn = {
                id: `temp_etc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                type: 'etc',
                text: '',
                bbox: newBbox
            };
        } else {
            return;
        }
        
        state.currentJsonData.annotations.push(newAnn);
        state.isModified = true;
        
        // 선택하고 편집 팝업 열기
        state.focusedAnnotationId = newAnn.id;
        renderAnnotationList();
        drawBboxes();
        
        // 편집 팝업 열기
        openEditPopup(newAnn);
        
        // 목록에서 선택 표시
        document.querySelectorAll('.annotation-item').forEach(el => {
            el.classList.remove('selected');
            if (el.dataset.id === newAnn.id) {
                el.classList.add('selected');
            }
        });
    }


    // ============================================
    // JSON 저장 (서버 경로)
    // ============================================
    async function saveCurrentJson() {
        if (!state.currentJsonData) {
            throw new Error('저장할 데이터가 없습니다.');
        }
        
        // 저장경로에서 읽어온 파일이면 저장경로에 저장, 아니면 저장경로 우선 사용
        const savePath = (state.currentJsonSource === 'save' && state.saveFolderPath) 
            ? state.saveFolderPath 
            : (state.saveFolderPath || state.jsonFolderPath);
        
        if (!savePath) {
            throw new Error('저장 경로를 설정해주세요.');
        }
        
        const imageFile = state.currentImageFiles[state.currentIndex];
        const baseName = imageFile.replace(/\.(jpg|jpeg|png|gif|bmp|webp|tiff)$/i, '');
        const filename = baseName + '.json';
        
        // 이미지 확장자
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'];
        let imagePath = null;
        let imageFilename = null;
        
        // 저장경로에서 읽어온 경우 이미지는 이미 저장경로에 있으므로 이동할 필요 없음
        if (state.currentJsonSource === 'save' && state.saveFolderPath) {
            // 이미지는 이미 저장경로에 있으므로 imagePath와 imageFilename을 전달하지 않음
            imageFilename = null;
            imagePath = null;
        } else {
            if (!state.currentImageFolderPath) {
                alert('이미지 폴더 경로가 설정되지 않았습니다.');
                return;
            }
            
            if (state.currentImageFiles.includes(imageFile)) {
                imageFilename = imageFile;
                imagePath = `${state.currentImageFolderPath}/${imageFile}`;
            }
            
            // 원본 폴더에 이미지가 없으면 이미지 이동하지 않음
            // (이미 저장경로에 있거나 없는 경우이므로)
        }
        
        // 저장 전에 KEY_ID를 1부터 연속되게 재정렬 (BBOX 위치 기준)
        if (state.currentJsonData && state.currentJsonData.annotations && state.currentJsonData.annotations.length > 0) {
            // 모든 KEY 어노테이션 찾기
            const allAnnotations = state.currentJsonData.annotations;
            const keys = allAnnotations.filter(a => a.type === 'key');
            
            if (keys.length > 0) {
                console.log(`[KEY_ID 재정렬] ${keys.length}개 KEY 발견, 재정렬 시작`);
                
                // BBOX 위치 기준으로 정렬 (왼쪽 상단에서 오른쪽 하단으로)
                const sortedKeys = [...keys].sort((a, b) => {
                    if (!a.bbox || a.bbox.length !== 4) return 1;
                    if (!b.bbox || b.bbox.length !== 4) return -1;
                    
                    const [ax1, ay1] = a.bbox;
                    const [bx1, by1] = b.bbox;
                    
                    // 먼저 y 좌표로 정렬 (위에서 아래로)
                    const yDiff = ay1 - by1;
                    if (Math.abs(yDiff) > 20) {
                        // 20픽셀 이상 차이나면 다른 줄로 간주
                        return yDiff;
                    }
                    
                    // 같은 줄이면 x 좌표로 정렬 (왼쪽에서 오른쪽으로)
                    return ax1 - bx1;
                });
                
                // key_id 매핑 생성 (기존 key_id -> 새로운 key_id)
                const keyIdMapping = {};
                sortedKeys.forEach((key, index) => {
                    const oldKeyId = key.key_id;
                    const newKeyId = index + 1;
                    if (oldKeyId !== null && oldKeyId !== undefined) {
                        keyIdMapping[String(oldKeyId)] = newKeyId;
                    }
                });
                
                // 원본 배열의 KEY 객체 직접 수정
                sortedKeys.forEach((key, index) => {
                    const oldKeyId = key.key_id;
                    const newKeyId = index + 1;
                    key.key_id = newKeyId;
                    console.log(`[KEY_ID 재정렬] KEY ${oldKeyId} → ${newKeyId} (bbox: [${key.bbox[0]}, ${key.bbox[1]}])`);
                });
                
                // 연결된 VALUE들의 key_id도 업데이트
                let valueUpdateCount = 0;
                allAnnotations.forEach(ann => {
                    if (ann.type === 'value' && ann.key_id !== null && ann.key_id !== undefined) {
                        const oldKeyId = String(ann.key_id);
                        if (keyIdMapping[oldKeyId]) {
                            ann.key_id = keyIdMapping[oldKeyId];
                            valueUpdateCount++;
                        }
                    }
                });
                
                console.log(`[KEY_ID 재정렬] 완료: ${keys.length}개 KEY, ${valueUpdateCount}개 VALUE 업데이트`);
            }
        }
        
        // JSON 저장 시 KEY_ID 순서대로 정렬
        if (state.currentJsonData && state.currentJsonData.annotations) {
            // KEY, VALUE, ETC 순서로 정렬하고, KEY는 key_id 순서대로
            const sortedAnnotations = [];
            
            // KEY들을 key_id 순서대로 정렬
            const keys = state.currentJsonData.annotations.filter(a => a.type === 'key');
            keys.sort((a, b) => {
                const aId = a.key_id || 0;
                const bId = b.key_id || 0;
                return aId - bId;
            });
            
            // 각 KEY와 연결된 VALUE들을 순서대로 추가
            keys.forEach(key => {
                sortedAnnotations.push(key);
                const linkedValues = state.currentJsonData.annotations
                    .filter(a => a.type === 'value' && String(a.key_id) === String(key.key_id))
                    .sort((a, b) => (a.order || 1) - (b.order || 1));
                sortedAnnotations.push(...linkedValues);
            });
            
            // ETC 항목들 추가
            const etcs = state.currentJsonData.annotations.filter(a => a.type === 'etc');
            sortedAnnotations.push(...etcs);
            
            // 정렬된 annotations로 교체
            state.currentJsonData.annotations = sortedAnnotations;
        }
        
        // JSON 저장 및 이미지 이동 (원본 폴더에서 읽은 경우에만)
        const requestBody = {
            folderPath: savePath,
            filename: filename,
            data: state.currentJsonData
        };
        
        // 이미지가 있고 저장경로에서 읽어온 게 아닌 경우에만 이미지 이동
        if (imagePath && imageFilename && !(state.currentJsonSource === 'save' && state.saveFolderPath)) {
            requestBody.imagePath = imagePath;
            requestBody.imageFilename = imageFilename;
        }
        
        try {
            const response = await fetch('/editor/save-json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '저장 실패');
            }
            state.isModified = false;
            console.log('✅ 저장 성공: KEY_ID 재정렬 완료');
            
            // 저장 성공 후 목록에서 제거
            const currentImageFile = state.currentImageFiles[state.currentIndex];
            state.currentImageFiles = state.currentImageFiles.filter(f => f !== currentImageFile);
            
            if (state.currentImageFiles.length === 0) {
                alert('모든 파일을 처리했습니다.');
                document.querySelector('.path-section').hidden = false;
                elements.viewerSection.hidden = true;
                return;
            }
            
            if (state.currentIndex >= state.currentImageFiles.length) {
                state.currentIndex = state.currentImageFiles.length - 1;
            }
            
            loadCurrentFile();
        } catch (err) {
            console.error('JSON 저장 실패:', err);
            alert(`저장 실패: ${err.message}`);
            throw err; // 에러를 다시 throw하여 saveAndNavigate에서 처리할 수 있도록
        }
    }

    // ============================================
    // 초기화 실행
    // ============================================
    document.addEventListener('DOMContentLoaded', init);
})();
