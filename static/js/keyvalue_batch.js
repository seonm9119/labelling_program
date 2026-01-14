/**
 * Key-Value 대용량 자동처리 JavaScript
 * 폴더 업로드 → 서버 처리 → ZIP 다운로드 방식
 */

(function() {
    'use strict';

    // ============================================
    // 상태 관리
    // ============================================
    const state = {
        imageFiles: [],           // {name, file} 형태
        logisticsFiles: [],       // {name, file} 형태
        paddleFiles: [],          // {name, file} 형태
        annotationTemplate: null, // 템플릿 JSON 객체
        isProcessing: false,
        shouldStop: false,
        startTime: null,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        resultJsons: []           // 결과 JSON 저장 (ZIP 다운로드용)
    };

    // ============================================
    // DOM 요소
    // ============================================
    const elements = {
        // 폴더 업로드
        imageFolder: document.getElementById('imageFolder'),
        imageUploadArea: document.getElementById('imageUploadArea'),
        annotationFile: document.getElementById('annotationFile'),
        annotationUploadArea: document.getElementById('annotationUploadArea'),
        logisticsFolder: document.getElementById('logisticsFolder'),
        logisticsUploadArea: document.getElementById('logisticsUploadArea'),
        paddleFolder: document.getElementById('paddleFolder'),
        paddleUploadArea: document.getElementById('paddleUploadArea'),
        
        // 상태 표시
        imageStatus: document.getElementById('imageStatus'),
        annotationStatus: document.getElementById('annotationStatus'),
        logisticsStatus: document.getElementById('logisticsStatus'),
        paddleStatus: document.getElementById('paddleStatus'),
        
        // 정보 표시
        imageInfo: document.getElementById('imageInfo'),
        annotationInfo: document.getElementById('annotationInfo'),
        logisticsInfo: document.getElementById('logisticsInfo'),
        paddleInfo: document.getElementById('paddleInfo'),
        
        // 버튼
        startBatchBtn: document.getElementById('startBatchBtn'),
        stopBatchBtn: document.getElementById('stopBatchBtn'),
        
        // 진행 상황
        progressSection: document.getElementById('progressSection'),
        progressBar: document.getElementById('progressBar'),
        processedCount: document.getElementById('processedCount'),
        totalCount: document.getElementById('totalCount'),
        progressPercent: document.getElementById('progressPercent'),
        estimatedTime: document.getElementById('estimatedTime'),
        currentFileName: document.getElementById('currentFileName'),
        
        // 결과
        resultSection: document.getElementById('resultSection'),
        successCount: document.getElementById('successCount'),
        errorCount: document.getElementById('errorCount'),
        elapsedTime: document.getElementById('elapsedTime'),
        resultTableBody: document.getElementById('resultTableBody')
    };

    // ============================================
    // 초기화
    // ============================================
    function init() {
        setupEventListeners();
        updateButtonState();
    }

    function setupEventListeners() {
        // 이미지 폴더 업로드
        setupFolderUpload(elements.imageUploadArea, elements.imageFolder, handleImageFolderUpload);
        
        // 어노테이션 파일 업로드
        setupFileUpload(elements.annotationUploadArea, elements.annotationFile, handleAnnotationUpload);
        
        // 물류 OCR 폴더 업로드
        setupFolderUpload(elements.logisticsUploadArea, elements.logisticsFolder, handleLogisticsFolderUpload);
        
        // PaddleOCR 폴더 업로드
        setupFolderUpload(elements.paddleUploadArea, elements.paddleFolder, handlePaddleFolderUpload);
        
        // 처리 버튼
        elements.startBatchBtn.addEventListener('click', startBatchProcessing);
        elements.stopBatchBtn.addEventListener('click', stopBatchProcessing);
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
            
            // webkitdirectory는 드롭으로 폴더 전달이 제한적
            // 파일들을 처리
            const items = e.dataTransfer.items;
            if (items) {
                handleDroppedItems(items, handler);
            }
        });
    }

    function setupFileUpload(uploadArea, inputElement, handler) {
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
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handler({ target: { files: files } });
            }
        });
    }

    async function handleDroppedItems(items, handler) {
        // DataTransferItemList에서 파일 추출
        const files = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry && entry.isDirectory) {
                    // 폴더인 경우 재귀적으로 파일 수집
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
        
        state.imageFiles = imageFiles.map(f => ({
            name: f.name,
            file: f
        }));
        
        if (state.imageFiles.length > 0) {
            elements.imageInfo.textContent = `✅ ${state.imageFiles.length}개 이미지 파일 선택됨`;
            elements.imageStatus.textContent = '선택됨';
            elements.imageStatus.className = 'upload-status status-success';
        } else {
            elements.imageInfo.textContent = '❌ 이미지 파일이 없습니다';
            elements.imageStatus.textContent = '미선택';
            elements.imageStatus.className = 'upload-status';
        }
        
        updateButtonState();
    }

    function handleLogisticsFolderUpload(e) {
        const files = Array.from(e.target.files);
        const jsonFiles = files.filter(f => f.name.endsWith('.json'));
        
        state.logisticsFiles = jsonFiles.map(f => ({
            name: f.name,
            file: f
        }));
        
        if (state.logisticsFiles.length > 0) {
            elements.logisticsInfo.textContent = `✅ ${state.logisticsFiles.length}개 JSON 파일 선택됨`;
            elements.logisticsStatus.textContent = '선택됨';
            elements.logisticsStatus.className = 'upload-status status-success';
        } else {
            elements.logisticsInfo.textContent = '❌ JSON 파일이 없습니다';
            elements.logisticsStatus.textContent = '미선택';
            elements.logisticsStatus.className = 'upload-status';
        }
        
        updateButtonState();
    }

    function handlePaddleFolderUpload(e) {
        const files = Array.from(e.target.files);
        const jsonFiles = files.filter(f => f.name.endsWith('.json'));
        
        state.paddleFiles = jsonFiles.map(f => ({
            name: f.name,
            file: f
        }));
        
        if (state.paddleFiles.length > 0) {
            elements.paddleInfo.textContent = `✅ ${state.paddleFiles.length}개 JSON 파일 선택됨`;
            elements.paddleStatus.textContent = '선택됨';
            elements.paddleStatus.className = 'upload-status status-success';
        } else {
            elements.paddleInfo.textContent = '❌ JSON 파일이 없습니다';
            elements.paddleStatus.textContent = '미선택';
            elements.paddleStatus.className = 'upload-status';
        }
        
        updateButtonState();
    }

    function handleAnnotationUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                state.annotationTemplate = JSON.parse(evt.target.result);
                elements.annotationInfo.textContent = `✅ ${file.name} (${state.annotationTemplate.annotations?.length || 0}개 어노테이션)`;
                elements.annotationStatus.textContent = '업로드됨';
                elements.annotationStatus.className = 'upload-status status-success';
            } catch (err) {
                alert('JSON 파일을 읽을 수 없습니다: ' + err.message);
                elements.annotationInfo.textContent = `❌ JSON 파싱 오류`;
                elements.annotationStatus.textContent = '오류';
                elements.annotationStatus.className = 'upload-status status-error';
            }
            updateButtonState();
        };
        reader.readAsText(file);
    }

    // ============================================
    // 상태 관리
    // ============================================
    function updateButtonState() {
        const ready = !!(
            state.imageFiles.length > 0 && 
            state.annotationTemplate && 
            state.logisticsFiles.length > 0 && 
            state.paddleFiles.length > 0
        );
        
        elements.startBatchBtn.disabled = !ready || state.isProcessing;
        elements.stopBatchBtn.disabled = !state.isProcessing;
    }

    // ============================================
    // 일괄 처리
    // ============================================
    async function startBatchProcessing() {
        if (state.isProcessing) return;

        state.isProcessing = true;
        state.shouldStop = false;
        state.startTime = Date.now();
        state.processed = 0;
        state.succeeded = 0;
        state.failed = 0;
        state.results = [];
        state.resultJsons = [];

        elements.progressSection.hidden = false;
        elements.resultSection.hidden = true;
        elements.totalCount.textContent = state.imageFiles.length;
        
        updateButtonState();

        console.log(`[일괄 처리 시작] ${state.imageFiles.length}개 이미지 처리`);

        // 물류/Paddle 파일을 Map으로 변환 (빠른 검색용)
        const logisticsMap = new Map();
        for (const f of state.logisticsFiles) {
            const baseName = f.name.replace('.json', '');
            logisticsMap.set(baseName, f.file);
        }
        
        const paddleMap = new Map();
        for (const f of state.paddleFiles) {
            const baseName = f.name.replace('.json', '');
            paddleMap.set(baseName, f.file);
        }

        // 순차 처리
        for (let i = 0; i < state.imageFiles.length; i++) {
            if (state.shouldStop) break;
            
            const imageFile = state.imageFiles[i];
            await processImage(imageFile, logisticsMap, paddleMap);
        }

        finishProcessing();
    }

    async function processImage(imageFile, logisticsMap, paddleMap) {
        if (state.shouldStop) return;

        const startTime = Date.now();
        const baseName = imageFile.name.replace(/\.(jpg|jpeg|png|gif|bmp|webp)$/i, '');
        elements.currentFileName.textContent = imageFile.name;

        try {
            // 해당 이미지의 OCR 파일 찾기
            const logisticsFile = logisticsMap.get(baseName);
            const paddleFile = paddleMap.get(baseName);
            
            if (!logisticsFile) {
                throw new Error(`물류 OCR 파일 없음: ${baseName}.json`);
            }
            if (!paddleFile) {
                throw new Error(`PaddleOCR 파일 없음: ${baseName}.json`);
            }

            // 파일 읽기
            const logisticsData = await readFileAsJson(logisticsFile);
            const paddleData = await readFileAsJson(paddleFile);

            // 자동맵핑 수행 (서버 API 호출)
            const result = await callServerAutoMapping(
                imageFile.name,
                state.annotationTemplate,
                paddleData,
                logisticsData
            );

            const elapsedMs = Date.now() - startTime;

            if (result.annotations && result.annotations.length > 0) {
                const keyCount = result.annotations.filter(a => a.type === 'key').length;
                const valueCount = result.annotations.filter(a => a.type === 'value').length;
                
                state.succeeded++;
                state.results.push({
                    filename: imageFile.name,
                    status: 'success',
                    keyCount,
                    valueCount,
                    elapsedMs
                });
                
                // 결과 JSON 저장
                state.resultJsons.push({
                    filename: baseName + '.json',
                    data: result
                });
                
                console.log(`✅ [${imageFile.name}] 성공 (KEY: ${keyCount}, VALUE: ${valueCount}, ${elapsedMs}ms)`);
            } else {
                throw new Error('자동맵핑 결과가 비어있습니다');
            }

        } catch (err) {
            const elapsedMs = Date.now() - startTime;
            state.failed++;
            state.results.push({
                filename: imageFile.name,
                status: 'error',
                error: err.message,
                elapsedMs
            });
            console.error(`❌ [${imageFile.name}] 예외:`, err);
        }

        state.processed++;
        updateProgress();
    }

    function readFileAsJson(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    resolve(JSON.parse(e.target.result));
                } catch (err) {
                    reject(new Error(`JSON 파싱 오류: ${file.name}`));
                }
            };
            reader.onerror = () => reject(new Error(`파일 읽기 오류: ${file.name}`));
            reader.readAsText(file);
        });
    }

    /**
     * 서버 API를 통한 자동맵핑 수행 (auto_mapping.py 사용)
     */
    async function callServerAutoMapping(imageName, template, paddleData, logisticsData) {
        const response = await fetch('/batch/auto-mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_name: imageName,
                template: template,
                paddle_ocr: paddleData,
                logistics_ocr: logisticsData
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '서버 오류');
        }
        
        return await response.json();
    }

    // ============================================
    // 자동맵핑 로직 (클라이언트 측)
    // ============================================
    function performAutoMapping(imageName, template, paddleData, logisticsData) {
        // 템플릿 복제
        const result = {
            image: imageName,
            width: template.width || 0,
            height: template.height || 0,
            annotations: []
        };

        if (!template.annotations || template.annotations.length === 0) {
            return result;
        }

        // PaddleOCR 데이터 파싱
        const paddleWords = parsePaddleOCR(paddleData);
        
        // 물류 OCR 데이터 파싱
        const logisticsWords = parseLogisticsOCR(logisticsData);
        
        console.log(`[자동맵핑] paddleWords: ${paddleWords.length}개, logisticsWords: ${logisticsWords.length}개`);

        // annotation에 임시 ID 부여 (id가 없는 경우)
        template.annotations.forEach((ann, idx) => {
            if (ann._tempId === undefined) {
                ann._tempId = ann.id !== undefined ? ann.id : `temp_${idx}`;
            }
        });

        // 수동맵핑에서 KEY, VALUE, ETC 분류
        const manualKeys = template.annotations.filter(a => a.type === 'key');
        const manualValues = template.annotations.filter(a => a.type === 'value');
        const manualEtcs = template.annotations.filter(a => a.type === 'etc');

        // bbox 이동 추적 (임시 ID 사용)
        const movedBboxMap = {};
        const totalDeltaMap = {};
        
        template.annotations.forEach(ann => {
            const id = ann._tempId;
            movedBboxMap[id] = [...ann.bbox];
            totalDeltaMap[id] = [0, 0];
        });

        // ========== 1단계: KEY 기준 이동 ==========
        const stage1MatchedKeyIds = new Set();
        
        for (const manualKey of manualKeys) {
            const keyTempId = manualKey._tempId;
            const currentBbox = movedBboxMap[keyTempId];
            if (!currentBbox) continue;
            
            const manualLines = (manualKey.text || '').split('\n').map(l => l.trim()).filter(l => l);
            
            let matchedPaddle = null;
            
            // 1차: 텍스트 완전 일치 (띄어쓰기 제외)
            const textCandidates = paddleWords.filter(pw => 
                manualLines.some(line => textContainsSingle(line, pw.text))
            );
            
            if (textCandidates.length > 0) {
                // 가장 왼쪽 상단 선택
                matchedPaddle = textCandidates.reduce((a, b) => 
                    (a.bbox[0] + a.bbox[1]) < (b.bbox[0] + b.bbox[1]) ? a : b
                );
            } else {
                // 2차: 60% IoU로 PaddleOCR 찾기
                let bestIou = 0.6;
                for (const pw of paddleWords) {
                    const iou = calculateIoU(currentBbox, pw.bbox);
                    if (iou > bestIou) {
                        bestIou = iou;
                        matchedPaddle = pw;
                    }
                }
            }
            
            if (!matchedPaddle) continue;
            
            const deltaX = matchedPaddle.bbox[0] - currentBbox[0];
            const deltaY = matchedPaddle.bbox[1] - currentBbox[1];
            
            // KEY bbox 이동 (크기 유지)
            movedBboxMap[keyTempId] = [
                matchedPaddle.bbox[0],
                matchedPaddle.bbox[1],
                matchedPaddle.bbox[0] + (currentBbox[2] - currentBbox[0]),
                matchedPaddle.bbox[1] + (currentBbox[3] - currentBbox[1])
            ];
            totalDeltaMap[keyTempId] = [deltaX, deltaY];
            stage1MatchedKeyIds.add(keyTempId);
            
            // 연결된 VALUE도 같이 이동 (key_id로 연결)
            for (const manualValue of manualValues) {
                if (String(manualValue.key_id) === String(manualKey.key_id)) {
                    const valTempId = manualValue._tempId;
                    const valBbox = movedBboxMap[valTempId];
                    if (valBbox) {
                        movedBboxMap[valTempId] = [
                            valBbox[0] + deltaX,
                            valBbox[1] + deltaY,
                            valBbox[2] + deltaX,
                            valBbox[3] + deltaY
                        ];
                        totalDeltaMap[valTempId] = [deltaX, deltaY];
                    }
                }
            }
        }

        // ========== 2단계: KEY bbox를 PaddleOCR bbox로 조정 ==========
        for (const manualKey of manualKeys) {
            const keyTempId = manualKey._tempId;
            const currentBbox = movedBboxMap[keyTempId];
            if (!currentBbox) continue;
            
            let bestIou = 0.6;
            let bestPaddle = null;
            
            for (const pw of paddleWords) {
                const iou = calculateIoU(currentBbox, pw.bbox);
                if (iou > bestIou) {
                    bestIou = iou;
                    bestPaddle = pw;
                }
            }
            
            if (bestPaddle) {
                // 가로 클리핑
                let newBbox = [...bestPaddle.bbox];
                if (newBbox[0] < currentBbox[0]) newBbox[0] = currentBbox[0];
                if (newBbox[2] > currentBbox[2]) newBbox[2] = currentBbox[2];
                movedBboxMap[keyTempId] = newBbox;
            }
        }

        // ========== 3단계: VALUE를 물류 OCR로 매칭 ==========
        const valueResultMap = {};
        
        for (const manualValue of manualValues) {
            const valTempId = manualValue._tempId;
            const currentBbox = movedBboxMap[valTempId];
            if (!currentBbox) {
                valueResultMap[valTempId] = {
                    bbox: manualValue.bbox || [0, 0, 0, 0],
                    text: manualValue.text || '',
                    matched: false
                };
                continue;
            }
            
            const matchingLogistics = [];
            
            for (const lw of logisticsWords) {
                const overlapRatio = calculateOverlapRatio(lw.bbox, currentBbox);
                if (overlapRatio >= 0.6) {
                    matchingLogistics.push(lw);
                }
            }
            
            if (matchingLogistics.length > 0) {
                // bbox 합치기
                const combinedBbox = [
                    Math.min(...matchingLogistics.map(w => w.bbox[0])),
                    Math.min(...matchingLogistics.map(w => w.bbox[1])),
                    Math.max(...matchingLogistics.map(w => w.bbox[2])),
                    Math.max(...matchingLogistics.map(w => w.bbox[3]))
                ];
                
                // 텍스트 합치기 (Y좌표로 정렬 후 X좌표)
                matchingLogistics.sort((a, b) => {
                    if (Math.abs(a.bbox[1] - b.bbox[1]) < 10) {
                        return a.bbox[0] - b.bbox[0];
                    }
                    return a.bbox[1] - b.bbox[1];
                });
                const combinedText = matchingLogistics.map(w => w.text).join(' ');
                
                valueResultMap[valTempId] = {
                    bbox: combinedBbox,
                    text: combinedText,
                    matched: true
                };
            } else {
                valueResultMap[valTempId] = {
                    bbox: currentBbox,
                    text: manualValue.text || '',
                    matched: false
                };
            }
        }

        // ========== 4단계: ETC를 PaddleOCR로 매칭 ==========
        for (const manualEtc of manualEtcs) {
            const etcTempId = manualEtc._tempId;
            const currentBbox = movedBboxMap[etcTempId];
            if (!currentBbox) continue;
            
            let bestIou = 0.6;
            let bestPaddle = null;
            
            for (const pw of paddleWords) {
                const iou = calculateIoU(currentBbox, pw.bbox);
                if (iou > bestIou) {
                    bestIou = iou;
                    bestPaddle = pw;
                }
            }
            
            if (bestPaddle) {
                movedBboxMap[etcTempId] = [...bestPaddle.bbox];
            }
        }

        // ========== 결과 생성 ==========
        // KEY의 key_id 매핑 (tempId -> key_id)
        const keyIdMap = {};
        manualKeys.forEach((manualKey, idx) => {
            const keyId = manualKey.key_id !== undefined ? manualKey.key_id : (idx + 1);
            keyIdMap[manualKey._tempId] = keyId;
        });
        
        for (const manualKey of manualKeys) {
            const keyTempId = manualKey._tempId;
            const keyId = keyIdMap[keyTempId];
            const bbox = movedBboxMap[keyTempId] || manualKey.bbox;
            
            result.annotations.push({
                type: 'key',
                bbox: bbox,
                text: manualKey.text || '',
                key_id: keyId
            });
        }
        
        for (const manualValue of manualValues) {
            const valTempId = manualValue._tempId;
            const valueResult = valueResultMap[valTempId] || {
                bbox: movedBboxMap[valTempId] || manualValue.bbox,
                text: manualValue.text || ''
            };
            
            // VALUE의 key_id는 수동맵핑에서 가져옴
            const linkedKeyId = manualValue.key_id;
            
            result.annotations.push({
                type: 'value',
                bbox: valueResult.bbox,
                text: valueResult.text,
                key_id: linkedKeyId,
                order: manualValue.order || 1
            });
        }
        
        for (const manualEtc of manualEtcs) {
            const etcTempId = manualEtc._tempId;
            const bbox = movedBboxMap[etcTempId] || manualEtc.bbox;
            
            result.annotations.push({
                type: 'etc',
                bbox: bbox,
                text: manualEtc.text || ''
            });
        }

        return result;
    }

    // ============================================
    // 유틸리티 함수들
    // ============================================
    function parsePaddleOCR(data) {
        const words = [];
        if (!data || !data.annotations) return words;
        
        for (const ann of data.annotations) {
            if (ann.bbox && ann.text) {
                words.push({
                    bbox: ann.bbox,
                    text: ann.text
                });
            }
        }
        return words;
    }

    function parseLogisticsOCR(data) {
        const words = [];
        if (!data) return words;
        
        // 형식 1: { bbox: [...] } with x, y arrays (물류 OCR 데이터셋 형식) - keyvalue_auto.js와 동일
        if (data.bbox && Array.isArray(data.bbox) && data.bbox.length > 0 && data.bbox[0].x) {
            for (const item of data.bbox) {
                if (item.x && item.y && (item.data || item.text)) {
                    const xs = item.x;
                    const ys = item.y;
                    
                    // 4개의 점에서 bbox 추출 (min/max)
                    const x1 = Math.min(...xs);
                    const y1 = Math.min(...ys);
                    const x2 = Math.max(...xs);
                    const y2 = Math.max(...ys);
                    
                    words.push({
                        text: item.data || item.text || '',
                        bbox: [x1, y1, x2, y2]
                    });
                }
            }
            return words;
        }
        
        // 형식 2: { words: [...] }
        if (data.words && Array.isArray(data.words)) {
            return data.words.filter(w => w.bbox && w.text);
        }
        
        // 형식 3: 배열 형태
        const items = Array.isArray(data) ? data : (data.items || data.data || []);
        
        for (const item of items) {
            if (item.x && item.y && (item.data || item.text)) {
                const x = item.x;
                const y = item.y;
                const bbox = [
                    Math.min(...x),
                    Math.min(...y),
                    Math.max(...x),
                    Math.max(...y)
                ];
                words.push({
                    bbox,
                    text: item.data || item.text || ''
                });
            } else if (item.bbox && item.text) {
                words.push({
                    bbox: item.bbox,
                    text: item.text
                });
            }
        }
        return words;
    }

    function textContainsSingle(manualLine, paddleText) {
        if (!manualLine || !paddleText) return false;
        const manualNoSpace = manualLine.trim().replace(/\s+/g, '').toLowerCase();
        const paddleNoSpace = paddleText.replace(/\s+/g, '').toLowerCase();
        
        // 완전 일치
        if (paddleNoSpace === manualNoSpace) return true;
        
        // 수동맵핑에 특수문자가 있는지 확인
        const hasSpecialChar = /[^a-zA-Z0-9]/.test(manualNoSpace);
        
        if (hasSpecialChar) {
            // 수동맵핑에 특수문자가 있으면 → 정확히 포함되어야 함
            return paddleNoSpace.includes(manualNoSpace);
        } else {
            // 수동맵핑에 특수문자가 없으면 → PaddleOCR에서 알파벳/숫자만 추출해서 비교
            const paddleAlphaOnly = paddleNoSpace.replace(/[^a-zA-Z0-9]/g, '');
            
            // 포함 관계 체크
            if (paddleAlphaOnly.includes(manualNoSpace) || manualNoSpace.includes(paddleAlphaOnly)) {
                return true;
            }
            
            // 유사도 체크 (80% 이상, 철자 오류 허용)
            const dist = levenshteinDistance(manualNoSpace, paddleAlphaOnly);
            const maxLen = Math.max(manualNoSpace.length, paddleAlphaOnly.length);
            const similarity = maxLen > 0 ? 1 - (dist / maxLen) : 0;
            
            return similarity >= 0.8;
        }
    }
    
    function levenshteinDistance(str1, str2) {
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
    }

    function calculateIoU(bbox1, bbox2) {
        const x1 = Math.max(bbox1[0], bbox2[0]);
        const y1 = Math.max(bbox1[1], bbox2[1]);
        const x2 = Math.min(bbox1[2], bbox2[2]);
        const y2 = Math.min(bbox1[3], bbox2[3]);
        
        const intersectionArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        if (intersectionArea === 0) return 0;
        
        const area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1]);
        const area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1]);
        const unionArea = area1 + area2 - intersectionArea;
        
        return unionArea > 0 ? intersectionArea / unionArea : 0;
    }

    function calculateOverlapRatio(smallBbox, largeBbox) {
        const x1 = Math.max(smallBbox[0], largeBbox[0]);
        const y1 = Math.max(smallBbox[1], largeBbox[1]);
        const x2 = Math.min(smallBbox[2], largeBbox[2]);
        const y2 = Math.min(smallBbox[3], largeBbox[3]);
        
        const intersectionArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const smallArea = (smallBbox[2] - smallBbox[0]) * (smallBbox[3] - smallBbox[1]);
        
        return smallArea > 0 ? intersectionArea / smallArea : 0;
    }

    // ============================================
    // 진행 상황 업데이트
    // ============================================
    function updateProgress() {
        const percent = Math.round((state.processed / state.imageFiles.length) * 100);
        
        elements.processedCount.textContent = state.processed;
        elements.progressPercent.textContent = percent;
        elements.progressBar.style.width = percent + '%';

        if (state.processed > 0) {
            const elapsed = (Date.now() - state.startTime) / 1000;
            const avgTime = elapsed / state.processed;
            const remaining = (state.imageFiles.length - state.processed) * avgTime;
            elements.estimatedTime.textContent = `예상 시간: ${Math.ceil(remaining)}초`;
        }
    }

    function stopBatchProcessing() {
        state.shouldStop = true;
        elements.stopBatchBtn.disabled = true;
        console.log('[일괄 처리] 중지 요청');
    }

    function finishProcessing() {
        state.isProcessing = false;
        updateButtonState();

        const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
        
        elements.progressSection.hidden = true;
        elements.resultSection.hidden = false;
        
        elements.successCount.textContent = state.succeeded;
        elements.errorCount.textContent = state.failed;
        elements.elapsedTime.textContent = elapsed;

        renderResultTable();

        // ZIP 다운로드 버튼 추가
        if (state.resultJsons.length > 0) {
            addDownloadButton();
        }

        console.log(`[일괄 처리 완료] 성공: ${state.succeeded}, 실패: ${state.failed}, 소요: ${elapsed}초`);
    }

    function renderResultTable() {
        elements.resultTableBody.innerHTML = '';

        state.results.forEach(result => {
            const tr = document.createElement('tr');
            
            // 파일명
            const tdFile = document.createElement('td');
            tdFile.textContent = result.filename;
            tr.appendChild(tdFile);

            // 상태
            const tdStatus = document.createElement('td');
            const statusBadge = document.createElement('span');
            if (result.status === 'success') {
                statusBadge.className = 'status-badge status-success';
                statusBadge.textContent = '✅ 성공';
            } else {
                statusBadge.className = 'status-badge status-error';
                statusBadge.textContent = '❌ 실패';
                statusBadge.title = result.error || '';
            }
            tdStatus.appendChild(statusBadge);
            tr.appendChild(tdStatus);

            // KEY 수
            const tdKey = document.createElement('td');
            tdKey.textContent = result.keyCount !== undefined ? result.keyCount : '-';
            tr.appendChild(tdKey);

            // VALUE 수
            const tdValue = document.createElement('td');
            tdValue.textContent = result.valueCount !== undefined ? result.valueCount : '-';
            tr.appendChild(tdValue);

            // 처리 시간
            const tdTime = document.createElement('td');
            tdTime.textContent = (result.elapsedMs / 1000).toFixed(2) + 's';
            tr.appendChild(tdTime);

            elements.resultTableBody.appendChild(tr);
        });
    }

    function addDownloadButton() {
        // 기존 다운로드 버튼 제거
        const existingBtn = document.getElementById('downloadZipBtn');
        if (existingBtn) existingBtn.remove();
        
        const downloadBtn = document.createElement('button');
        downloadBtn.id = 'downloadZipBtn';
        downloadBtn.className = 'btn btn-primary btn-large';
        downloadBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="7,10 12,15 17,10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            결과 ZIP 다운로드 (${state.resultJsons.length}개 파일)
        `;
        downloadBtn.addEventListener('click', downloadResultsAsZip);
        
        elements.resultSection.querySelector('.result-header').appendChild(downloadBtn);
    }

    async function downloadResultsAsZip() {
        // JSZip 라이브러리 동적 로드
        if (typeof JSZip === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            document.head.appendChild(script);
            await new Promise(resolve => script.onload = resolve);
        }
        
        const zip = new JSZip();
        
        for (const item of state.resultJsons) {
            zip.file(item.filename, JSON.stringify(item.data, null, 2));
        }
        
        const content = await zip.generateAsync({ type: 'blob' });
        
        // 다운로드
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `auto_mapping_results_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ============================================
    // 초기화 실행
    // ============================================
    document.addEventListener('DOMContentLoaded', init);
})();
