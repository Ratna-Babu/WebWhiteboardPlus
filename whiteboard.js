class AdvancedWhiteboardEngine {
    constructor(canvasId, containerId = null) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.container = containerId ? document.getElementById(containerId) : null;
        
        // Canvas properties
        this.pixelRatio = window.devicePixelRatio || 1;
        this.canvasOffset = { x: 0, y: 0 };
        this.zoom = 1;
        this.minZoom = 0.1;
        this.maxZoom = 5;
        
        // Drawing state
        this.isDrawing = false;
        this.isPanning = false;
        this.tool = 'pen';
        this.backgroundColor = 'transparent';
        // Grid settings
        this.grid = {
            enabled: true,
            minorStep: 20, // world units at zoom=1
            majorStep: 100,
            minorColor: 'rgba(0, 0, 0, 0.04)',
            majorColor: 'rgba(0, 0, 0, 0.07)'
        };

        // Precomputed SVG cursors for tools
        this.cursors = this.buildCursors();
        
        // Tool-specific settings
        this.toolSettings = {
            pen: { color: '#000000', size: 2 },
            eraser: { color: '#ffffff', size: 20 },
            rectangle: { color: '#000000', size: 2, fill: false },
            circle: { color: '#000000', size: 2, fill: false },
            line: { color: '#000000', size: 2 },
            text: { color: '#000000', size: 16, font: 'Arial' },
            select: { color: '#007bff', size: 1 }
        };
        
        // Drawing objects storage
        this.objects = [];
        this.selectedObjects = [];
        this.currentPath = null;
        this.tempObject = null;
        
        // Interaction state
        this.startX = 0;
        this.startY = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.lastX = 0;
        this.lastY = 0;
        this.panStartX = 0;
        this.panStartY = 0;
        
        // History for undo/redo
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 100;
        
        // Selection
        this.selectionBox = null;
        this.isSelecting = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isDragging = false;
        
        this.init();
    }
    
    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.saveState();
        this.render();
    }

    buildCursors() {
        const svgToCursor = (svg, x, y, fallback = 'crosshair') => {
            const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
            return `url("${uri}") ${x} ${y}, ${fallback}`;
        };

        const common = {
            size: 24
        };

        // Simple pencil icon
        const pencilSVG = `
            <svg xmlns='http://www.w3.org/2000/svg' width='${common.size}' height='${common.size}' viewBox='0 0 24 24'>
                <g fill='none' stroke='#333' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>
                    <path d='M3 21l3.5-1L20 6.5a2.1 2.1 0 0 0 0-3L20.5 4' />
                    <path d='M18 2l4 4' />
                    <path d='M3 21l1-3.5L14.5 7l3 3L7 20' />
                </g>
            </svg>`;

        const rectSVG = `
            <svg xmlns='http://www.w3.org/2000/svg' width='${common.size}' height='${common.size}' viewBox='0 0 24 24'>
                <rect x='4' y='4' width='16' height='16' fill='none' stroke='#333' stroke-width='2'/>
            </svg>`;

        const circleSVG = `
            <svg xmlns='http://www.w3.org/2000/svg' width='${common.size}' height='${common.size}' viewBox='0 0 24 24'>
                <circle cx='12' cy='12' r='8' fill='none' stroke='#333' stroke-width='2'/>
            </svg>`;

        const lineSVG = `
            <svg xmlns='http://www.w3.org/2000/svg' width='${common.size}' height='${common.size}' viewBox='0 0 24 24'>
                <path d='M4 20L20 4' stroke='#333' stroke-width='2' stroke-linecap='round'/>
            </svg>`;

        return {
            pen: svgToCursor(pencilSVG, 2, 22, 'crosshair'),
            rectangle: svgToCursor(rectSVG, 12, 12, 'crosshair'),
            circle: svgToCursor(circleSVG, 12, 12, 'crosshair'),
            line: svgToCursor(lineSVG, 4, 20, 'crosshair')
        };
    }
    
    setupCanvas() {
        // Set up high-DPI canvas
        let displayWidth, displayHeight;
        
        if (this.container) {
            // Use container dimensions
            displayWidth = this.container.clientWidth;
            displayHeight = this.container.clientHeight;
        } else {
            // Fallback to canvas dimensions
            const rect = this.canvas.getBoundingClientRect();
            displayWidth = rect.width || 800;
            displayHeight = rect.height || 600;
        }
        
        // Ensure minimum size
        displayWidth = Math.max(displayWidth, 400);
        displayHeight = Math.max(displayHeight, 300);
        
        this.canvas.width = displayWidth * this.pixelRatio;
        this.canvas.height = displayHeight * this.pixelRatio;
        this.canvas.style.width = displayWidth + 'px';
        this.canvas.style.height = displayHeight + 'px';
        
        // Scale context for high-DPI
        this.ctx.scale(this.pixelRatio, this.pixelRatio);
        
        // Set drawing properties for smooth lines
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        // Do not reset objects on resize; just re-render with new resolution
        // Background and all objects will be redrawn in render()
    }
    
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleStart(e));
        this.canvas.addEventListener('mousemove', (e) => {
            this.handleMove(e);
            this.updateHoverCursor(e);
        });
        this.canvas.addEventListener('mouseup', (e) => this.handleEnd(e));
        this.canvas.addEventListener('mouseout', (e) => {
            // Only finish drawing if pointer really left the document/window
            const toEl = e.relatedTarget;
            const reallyLeft = !toEl || toEl.nodeType === 9; // null or document
            
            if (reallyLeft && this.isDrawing) {
                this.handleEnd(e);
            }
            
            // Always freeze the preview at the last in-canvas position
            // Don't clear eraserCursorPos/penCursorPos here
            // They'll stay frozen until the next valid canvas mousemove
        });
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.handleStart(mouseEvent);
        });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.handleMove(mouseEvent);
        });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handleEnd(new MouseEvent('mouseup', {}));
        });
        
        // Keyboard events
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.canvasOffset.x) / this.zoom;
        const y = (e.clientY - rect.top - this.canvasOffset.y) / this.zoom;
        return { x, y };
    }
    
    handleStart(e) {
        const pos = this.getMousePos(e);
        this.startX = pos.x;
        this.startY = pos.y;
        this.lastX = pos.x;
        this.lastY = pos.y;
        
        if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
            // Middle mouse or Ctrl+click for panning
            this.isPanning = true;
            this.panStartX = e.clientX - this.canvasOffset.x;
            this.panStartY = e.clientY - this.canvasOffset.y;
            this.canvas.style.cursor = 'grabbing';
            return;
        }
        
        // Notify that drawing/interaction has started (for UI panels)
        if (this.onDrawingStart && typeof this.onDrawingStart === 'function') {
            this.onDrawingStart();
        }
        
        if (this.tool === 'select') {
            this.handleSelectStart(pos);
        } else if (this.tool === 'pen') {
            this.startDrawing(pos);
        } else if (this.tool === 'eraser') {
            this.startErasing(pos);
            // Also try object-level erasing (delete objects touched by eraser)
            this.eraseObjectsAtPoint(pos);
        } else if (this.tool === 'text') {
            this.addText(pos.x, pos.y);
        } else {
            this.isDrawing = true;
        }
    }
    
    handleMove(e) {
        const pos = this.getMousePos(e);
        this.currentX = pos.x;
        this.currentY = pos.y;
        
        if (this.isPanning) {
            this.canvasOffset.x = e.clientX - this.panStartX;
            this.canvasOffset.y = e.clientY - this.panStartY;
            this.render();
            return;
        }
        
        if (this.tool === 'select') {
            this.handleSelectMove(pos);
        } else if (this.tool === 'pen' && this.isDrawing) {
            this.continuDrawing(pos);
        } else if (this.tool === 'eraser' && this.isDrawing) {
            this.continueErasing(pos);
            this.eraseObjectsAtPoint(pos);
        } else if (this.isDrawing) {
            this.render();
            this.drawTempShape();
        }
        
        this.lastX = pos.x;
        this.lastY = pos.y;
    }
    
    handleEnd(e) {
        if (this.isPanning) {
            this.isPanning = false;
            this.canvas.style.cursor = this.getCursor();
            return;
        }
        
        if (!this.isDrawing && !this.isSelecting && !this.isDragging) return;
        
        if (this.tool === 'select') {
            this.handleSelectEnd();
        } else if (this.tool === 'pen' || this.tool === 'eraser') {
            this.finishPath();
        } else if (this.tool === 'rectangle') {
            this.finishRectangle();
        } else if (this.tool === 'circle') {
            this.finishCircle();
        } else if (this.tool === 'line') {
            this.finishLine();
        }
        
        this.isDrawing = false;
        this.isSelecting = false;
        this.isDragging = false;
        this.currentPath = null;
        this.tempObject = null;
        
        this.saveState();
        this.render();
    }
    
    handleWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * delta));
        
        if (newZoom !== this.zoom) {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Zoom towards mouse position
            this.canvasOffset.x = mouseX - (mouseX - this.canvasOffset.x) * (newZoom / this.zoom);
            this.canvasOffset.y = mouseY - (mouseY - this.canvasOffset.y) * (newZoom / this.zoom);
            
            this.zoom = newZoom;
            this.render();
        }
    }
    
    handleKeyDown(e) {
        if (e.key === 'Delete' && this.selectedObjects.length > 0) {
            this.deleteSelectedObjects();
        } else if (e.key === 'Escape') {
            this.clearSelection();
        } else if (e.ctrlKey && e.key === 'a') {
            e.preventDefault();
            this.selectAll();
        } else if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            this.undo();
        } else if (e.ctrlKey && e.key === 'y') {
            e.preventDefault();
            this.redo();
        }
    }
    
    // Drawing methods with smooth curves
    startDrawing(pos) {
        this.isDrawing = true;
        this.currentPath = {
            type: 'path',
            points: [{ x: pos.x, y: pos.y }],
            color: this.toolSettings[this.tool].color,
            size: this.toolSettings[this.tool].size,
            tool: this.tool
        };
    }
    
    continuDrawing(pos) {
        if (!this.currentPath) return;
        
        // Add point with distance threshold for smoother curves
        const lastPoint = this.currentPath.points[this.currentPath.points.length - 1];
        const distance = Math.sqrt(Math.pow(pos.x - lastPoint.x, 2) + Math.pow(pos.y - lastPoint.y, 2));
        
        if (distance > 2) {
            this.currentPath.points.push({ x: pos.x, y: pos.y });
            this.render();
            // Don't draw the path again here - render() already handles it
        }
    }
    
    startErasing(pos) {
        this.isDrawing = true;
        this.currentPath = {
            type: 'eraser_stroke',
            points: [{ x: pos.x, y: pos.y }],
            size: this.toolSettings.eraser.size
        };
        
        // Create an eraser stroke that will be applied
        this.applyEraserStroke(pos, pos);
    }
    
    continueErasing(pos) {
        if (!this.currentPath) return;
        
        const lastPoint = this.currentPath.points[this.currentPath.points.length - 1];
        const distance = Math.sqrt(Math.pow(pos.x - lastPoint.x, 2) + Math.pow(pos.y - lastPoint.y, 2));
        
        if (distance > 2) {
            this.currentPath.points.push({ x: pos.x, y: pos.y });
            this.applyEraserStroke(lastPoint, pos);
        }
    }

    eraseObjectsAtPoint(pos) {
        const radius = this.toolSettings.eraser.size / 2;
        const beforeCount = this.objects.length;
        this.objects = this.objects.filter(obj => !this.isPointNearObject(pos, obj, radius));
        if (this.objects.length !== beforeCount) {
            this.saveState();
            this.render();
        }
    }
    
    applyEraserStroke(startPos, endPos) {
        // Create eraser stroke object that removes content
        const eraserStroke = {
            type: 'eraser_stroke',
            startX: startPos.x,
            startY: startPos.y,
            endX: endPos.x,
            endY: endPos.y,
            size: this.toolSettings.eraser.size
        };
        
        // Add to objects so it's part of the undo/redo system
        this.objects.push(eraserStroke);
        
        // Re-render everything to apply the eraser effect
        this.render();
    }
    
    finishPath() {
        if (this.currentPath && this.currentPath.points.length > 1) {
            // Don't save eraser paths as objects (they're already added in applyEraserStroke)
            if (this.currentPath.type !== 'eraser_stroke' && this.currentPath.type !== 'eraser_path') {
                this.objects.push(this.currentPath);
            }
        }
    }
    
    finishRectangle() {
        const rect = {
            type: 'rectangle',
            x: Math.min(this.startX, this.currentX),
            y: Math.min(this.startY, this.currentY),
            width: Math.abs(this.currentX - this.startX),
            height: Math.abs(this.currentY - this.startY),
            color: this.toolSettings.rectangle.color,
            size: this.toolSettings.rectangle.size,
            fill: this.toolSettings.rectangle.fill
        };
        
        if (rect.width > 5 && rect.height > 5) {
            this.objects.push(rect);
        }
    }
    
    finishCircle() {
        const radius = Math.sqrt(
            Math.pow(this.currentX - this.startX, 2) + 
            Math.pow(this.currentY - this.startY, 2)
        );
        
        const circle = {
            type: 'circle',
            x: this.startX,
            y: this.startY,
            radius: radius,
            color: this.toolSettings.circle.color,
            size: this.toolSettings.circle.size,
            fill: this.toolSettings.circle.fill
        };
        
        if (radius > 5) {
            this.objects.push(circle);
        }
    }
    
    finishLine() {
        const line = {
            type: 'line',
            x1: this.startX,
            y1: this.startY,
            x2: this.currentX,
            y2: this.currentY,
            color: this.toolSettings.line.color,
            size: this.toolSettings.line.size
        };
        
        const length = Math.sqrt(Math.pow(this.currentX - this.startX, 2) + Math.pow(this.currentY - this.startY, 2));
        if (length > 5) {
            this.objects.push(line);
        }
    }
    
    addText(x, y) {
        const text = prompt('Enter text:');
        if (text && text.trim()) {
            const textObj = {
                type: 'text',
                x: x,
                y: y,
                text: text.trim(),
                color: this.toolSettings.text.color,
                size: this.toolSettings.text.size,
                font: this.toolSettings.text.font
            };
            
            this.objects.push(textObj);
            this.saveState();
            this.render();
        }
    }
    
    // Selection methods
    handleSelectStart(pos) {
        // Check if clicking on existing object
        const clickedObject = this.getObjectAtPoint(pos);
        
        if (clickedObject && this.selectedObjects.includes(clickedObject)) {
            // Start dragging selected objects
            this.isDragging = true;
            this.dragOffset.x = pos.x;
            this.dragOffset.y = pos.y;
        } else if (clickedObject) {
            // Select single object
            this.selectedObjects = [clickedObject];
            this.isDragging = true;
            this.dragOffset.x = pos.x;
            this.dragOffset.y = pos.y;
        } else {
            // Start selection box
            this.isSelecting = true;
            this.selectionBox = {
                startX: pos.x,
                startY: pos.y,
                endX: pos.x,
                endY: pos.y
            };
            this.selectedObjects = [];
        }
        
        this.render();
    }
    
    handleSelectMove(pos) {
        if (this.isDragging) {
            const deltaX = pos.x - this.dragOffset.x;
            const deltaY = pos.y - this.dragOffset.y;
            
            this.selectedObjects.forEach(obj => {
                this.moveObject(obj, deltaX, deltaY);
            });
            
            this.dragOffset.x = pos.x;
            this.dragOffset.y = pos.y;
            this.render();
        } else if (this.isSelecting) {
            this.selectionBox.endX = pos.x;
            this.selectionBox.endY = pos.y;
            this.render();
        }
    }
    
    handleSelectEnd() {
        if (this.isSelecting && this.selectionBox) {
            // Select objects within selection box
            const box = this.selectionBox;
            const minX = Math.min(box.startX, box.endX);
            const maxX = Math.max(box.startX, box.endX);
            const minY = Math.min(box.startY, box.endY);
            const maxY = Math.max(box.startY, box.endY);
            
            this.selectedObjects = this.objects.filter(obj => {
                return this.isObjectInBox(obj, minX, minY, maxX, maxY);
            });
            
            this.selectionBox = null;
        }
    }
    
    // Rendering methods
    render() {
        // Clear canvas
        this.ctx.save();
        this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Apply transformations
        this.ctx.translate(this.canvasOffset.x, this.canvasOffset.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        // Note: Background and grid are drawn after objects using destination-over
        
        // Draw all objects in order
        this.objects.forEach(obj => this.drawObject(obj));
        
        // Draw current path while drawing (only if not already rendered)
        if (this.currentPath && this.isDrawing) {
            if (this.currentPath.type === 'eraser_stroke') {
                this.drawEraserPreview(this.currentPath);
            } else {
                // Only draw preview for current path, not the final version
                this.ctx.save();
                this.ctx.globalAlpha = 0.8;
                this.drawSmoothPath(this.currentPath);
                this.ctx.restore();
            }
        }
        
        // Draw selection
        this.drawSelection();
        
        // Draw eraser cursor when hovering
        if (this.tool === 'eraser' && this.eraserCursorPos && !this.isDrawing) {
            this.drawEraserCursor();
        }
        // Draw pen cursor preview at pencil tip when hovering
        if (this.tool === 'pen' && this.penCursorPos && !this.isDrawing) {
            this.drawPenPreviewCursor();
        }
        
        // Draw grid underneath drawings so eraser never removes it
        this.drawGridUnderlay();
        
        this.ctx.restore();
    }

    drawGrid() {
        if (!this.grid || !this.grid.enabled) return;
        const viewLeft = -this.canvasOffset.x / this.zoom;
        const viewTop = -this.canvasOffset.y / this.zoom;
        const viewRight = viewLeft + (this.canvas.width / this.pixelRatio) / this.zoom;
        const viewBottom = viewTop + (this.canvas.height / this.pixelRatio) / this.zoom;

        const lineWidth = Math.max(0.5 / this.zoom, 0.25 / this.zoom);

        const drawLines = (step, color) => {
            this.ctx.save();
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = lineWidth;
            this.ctx.beginPath();

            // Vertical lines
            let startX = Math.floor(viewLeft / step) * step;
            for (let x = startX; x <= viewRight; x += step) {
                this.ctx.moveTo(x, viewTop);
                this.ctx.lineTo(x, viewBottom);
            }

            // Horizontal lines
            let startY = Math.floor(viewTop / step) * step;
            for (let y = startY; y <= viewBottom; y += step) {
                this.ctx.moveTo(viewLeft, y);
                this.ctx.lineTo(viewRight, y);
            }

            this.ctx.stroke();
            this.ctx.restore();
        };

        // Minor then major grid
        drawLines(this.grid.minorStep, this.grid.minorColor);
        drawLines(this.grid.majorStep, this.grid.majorColor);
    }

    drawGridUnderlay() {
        if (!this.grid || !this.grid.enabled) return;
        this.ctx.save();
        // Ensure grid is always underneath drawings, even after erasing
        this.ctx.globalCompositeOperation = 'destination-over';
        this.drawGrid();
        this.ctx.restore();
    }
    
    drawObject(obj) {
        this.ctx.save();
        
        switch (obj.type) {
            case 'path':
                this.drawSmoothPath(obj);
                break;
            case 'rectangle':
                this.drawRectangle(obj);
                break;
            case 'circle':
                this.drawCircle(obj);
                break;
            case 'line':
                this.drawLine(obj);
                break;
            case 'text':
                this.drawText(obj);
                break;
            case 'eraser_stroke':
                this.drawEraserStroke(obj);
                break;
        }
        
        this.ctx.restore();
    }
    
    drawSmoothPath(path) {
        if (path.points.length < 2) return;
        
        this.ctx.strokeStyle = path.color;
        this.ctx.lineWidth = path.size;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        if (path.points.length === 2) {
            // Simple line for two points
            this.ctx.beginPath();
            this.ctx.moveTo(path.points[0].x, path.points[0].y);
            this.ctx.lineTo(path.points[1].x, path.points[1].y);
            this.ctx.stroke();
            return;
        }
        
        // Smooth curve through multiple points
        this.ctx.beginPath();
        this.ctx.moveTo(path.points[0].x, path.points[0].y);
        
        for (let i = 1; i < path.points.length - 2; i++) {
            const cp1x = (path.points[i].x + path.points[i + 1].x) / 2;
            const cp1y = (path.points[i].y + path.points[i + 1].y) / 2;
            
            this.ctx.quadraticCurveTo(
                path.points[i].x,
                path.points[i].y,
                cp1x,
                cp1y
            );
        }
        
        // Final point
        if (path.points.length > 2) {
            this.ctx.quadraticCurveTo(
                path.points[path.points.length - 2].x,
                path.points[path.points.length - 2].y,
                path.points[path.points.length - 1].x,
                path.points[path.points.length - 1].y
            );
        }
        
        this.ctx.stroke();
    }
    
    drawRectangle(rect) {
        this.ctx.strokeStyle = rect.color;
        this.ctx.lineWidth = rect.size;
        
        if (rect.fill) {
            this.ctx.fillStyle = rect.color;
            this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        } else {
            this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        }
    }
    
    drawCircle(circle) {
        this.ctx.strokeStyle = circle.color;
        this.ctx.lineWidth = circle.size;
        
        this.ctx.beginPath();
        this.ctx.arc(circle.x, circle.y, circle.radius, 0, 2 * Math.PI);
        
        if (circle.fill) {
            this.ctx.fillStyle = circle.color;
            this.ctx.fill();
        } else {
            this.ctx.stroke();
        }
    }
    
    drawLine(line) {
        this.ctx.strokeStyle = line.color;
        this.ctx.lineWidth = line.size;
        this.ctx.beginPath();
        this.ctx.moveTo(line.x1, line.y1);
        this.ctx.lineTo(line.x2, line.y2);
        this.ctx.stroke();
    }
    
    drawText(text) {
        this.ctx.fillStyle = text.color;
        this.ctx.font = `${text.size}px ${text.font}`;
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(text.text, text.x, text.y);
    }
    
    drawEraserStroke(eraserStroke) {
        // Eraser strokes remove content using destination-out composite operation
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.strokeStyle = 'rgba(0,0,0,1)';
        this.ctx.lineWidth = eraserStroke.size;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        this.ctx.beginPath();
        this.ctx.moveTo(eraserStroke.startX, eraserStroke.startY);
        this.ctx.lineTo(eraserStroke.endX, eraserStroke.endY);
        this.ctx.stroke();
        
        // Also erase at the endpoints with circles for better coverage
        this.ctx.beginPath();
        this.ctx.arc(eraserStroke.startX, eraserStroke.startY, eraserStroke.size / 2, 0, 2 * Math.PI);
        this.ctx.fill();
        
        this.ctx.beginPath();
        this.ctx.arc(eraserStroke.endX, eraserStroke.endY, eraserStroke.size / 2, 0, 2 * Math.PI);
        this.ctx.fill();
        
        this.ctx.restore();
    }
    
    drawEraserPreview(eraserPath) {
        if (eraserPath.points.length === 0) return;
        
        // Only draw the cursor at the last point
        const lastPoint = eraserPath.points[eraserPath.points.length - 1];
        
        this.ctx.save();
        this.ctx.globalAlpha = 0.8;
        
        // Draw white fill
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.beginPath();
        this.ctx.arc(lastPoint.x, lastPoint.y, eraserPath.size / 2, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Draw gray border
        this.ctx.strokeStyle = 'rgba(128, 128, 128, 0.8)';
        this.ctx.lineWidth = 2 / this.zoom;
        this.ctx.beginPath();
        this.ctx.arc(lastPoint.x, lastPoint.y, eraserPath.size / 2, 0, 2 * Math.PI);
        this.ctx.stroke();
        
        this.ctx.restore();
    }
    
    drawEraserCursor() {
        if (!this.eraserCursorPos) return;
        
        this.ctx.save();
        this.ctx.globalAlpha = 0.7;
        
        // Draw white fill
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.beginPath();
        this.ctx.arc(this.eraserCursorPos.x, this.eraserCursorPos.y, this.toolSettings.eraser.size / 2, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Draw gray border
        this.ctx.strokeStyle = 'rgba(128, 128, 128, 0.8)';
        this.ctx.lineWidth = 2 / this.zoom;
        this.ctx.beginPath();
        this.ctx.arc(this.eraserCursorPos.x, this.eraserCursorPos.y, this.toolSettings.eraser.size / 2, 0, 2 * Math.PI);
        this.ctx.stroke();
        
        this.ctx.restore();
    }

    drawPenPreviewCursor() {
        if (!this.penCursorPos) return;
        this.ctx.save();
        this.ctx.globalAlpha = 0.9;
        const radius = (this.toolSettings.pen.size / 2);
        this.ctx.strokeStyle = 'rgba(51,51,51,0.9)';
        this.ctx.lineWidth = 1 / this.zoom;
        this.ctx.beginPath();
        this.ctx.arc(this.penCursorPos.x, this.penCursorPos.y, radius, 0, 2 * Math.PI);
        this.ctx.stroke();
        this.ctx.fillStyle = 'rgba(0,0,0,0.03)';
        this.ctx.beginPath();
        this.ctx.arc(this.penCursorPos.x, this.penCursorPos.y, Math.max(0, radius - 0.5 / this.zoom), 0, 2 * Math.PI);
        this.ctx.fill();
        this.ctx.restore();
    }
    
    drawSelection() {
        // Draw selection box
        if (this.selectionBox) {
            this.ctx.strokeStyle = '#007bff';
            this.ctx.lineWidth = 1 / this.zoom;
            this.ctx.setLineDash([5 / this.zoom, 5 / this.zoom]);
            this.ctx.strokeRect(
                this.selectionBox.startX,
                this.selectionBox.startY,
                this.selectionBox.endX - this.selectionBox.startX,
                this.selectionBox.endY - this.selectionBox.startY
            );
            this.ctx.setLineDash([]);
        }
        
        // Draw selected object highlights
        this.selectedObjects.forEach(obj => {
            this.ctx.strokeStyle = '#007bff';
            this.ctx.lineWidth = 2 / this.zoom;
            this.ctx.setLineDash([3 / this.zoom, 3 / this.zoom]);
            
            const bounds = this.getObjectBounds(obj);
            const padding = 5 / this.zoom;
            
            this.ctx.strokeRect(
                bounds.minX - padding,
                bounds.minY - padding,
                bounds.maxX - bounds.minX + 2 * padding,
                bounds.maxY - bounds.minY + 2 * padding
            );
            
            this.ctx.setLineDash([]);
        });
    }
    
    drawTempShape() {
        if (!this.isDrawing) return;
        
        this.ctx.save();
        this.ctx.translate(this.canvasOffset.x, this.canvasOffset.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        this.ctx.strokeStyle = this.toolSettings[this.tool].color;
        this.ctx.lineWidth = this.toolSettings[this.tool].size;
        this.ctx.setLineDash([5, 5]);
        
        if (this.tool === 'rectangle') {
            this.ctx.strokeRect(
                this.startX,
                this.startY,
                this.currentX - this.startX,
                this.currentY - this.startY
            );
        } else if (this.tool === 'circle') {
            const radius = Math.sqrt(
                Math.pow(this.currentX - this.startX, 2) + 
                Math.pow(this.currentY - this.startY, 2)
            );
            this.ctx.beginPath();
            this.ctx.arc(this.startX, this.startY, radius, 0, 2 * Math.PI);
            this.ctx.stroke();
        } else if (this.tool === 'line') {
            this.ctx.beginPath();
            this.ctx.moveTo(this.startX, this.startY);
            this.ctx.lineTo(this.currentX, this.currentY);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
    }
    
    // Utility methods
    getObjectAtPoint(point) {
        for (let i = this.objects.length - 1; i >= 0; i--) {
            if (this.isPointInObject(point, this.objects[i])) {
                return this.objects[i];
            }
        }
        return null;
    }
    
    isPointInObject(point, obj) {
        const tolerance = Math.max(5, obj.size || 5) / this.zoom;
        
        switch (obj.type) {
            case 'path':
                return obj.points.some(p => 
                    Math.sqrt(Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2)) < tolerance
                );
            case 'rectangle':
                return point.x >= obj.x - tolerance && 
                       point.x <= obj.x + obj.width + tolerance &&
                       point.y >= obj.y - tolerance && 
                       point.y <= obj.y + obj.height + tolerance;
            case 'circle':
                const dist = Math.sqrt(Math.pow(point.x - obj.x, 2) + Math.pow(point.y - obj.y, 2));
                return Math.abs(dist - obj.radius) < tolerance;
            case 'line':
                return this.distanceToLine(point, obj) < tolerance;
            case 'text':
                // Approximate text bounds
                const textWidth = obj.text.length * obj.size * 0.6;
                return point.x >= obj.x - tolerance && 
                       point.x <= obj.x + textWidth + tolerance &&
                       point.y >= obj.y - obj.size/2 - tolerance && 
                       point.y <= obj.y + obj.size/2 + tolerance;
            case 'eraser_stroke':
                // Check if point is near the eraser stroke line
                return this.distanceToLine(point, {
                    x1: obj.startX,
                    y1: obj.startY,
                    x2: obj.endX,
                    y2: obj.endY
                }) < tolerance;
        }
        return false;
    }
    
    isPointNearObject(point, obj, radius) {
        switch (obj.type) {
            case 'path':
                return obj.points.some(p => 
                    Math.sqrt(Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2)) < radius
                );
            default:
                return this.isPointInObject(point, obj);
        }
    }
    
    distanceToLine(point, line) {
        const A = point.x - line.x1;
        const B = point.y - line.y1;
        const C = line.x2 - line.x1;
        const D = line.y2 - line.y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        if (param < 0) {
            xx = line.x1;
            yy = line.y1;
        } else if (param > 1) {
            xx = line.x2;
            yy = line.y2;
        } else {
            xx = line.x1 + param * C;
            yy = line.y1 + param * D;
        }
        
        const dx = point.x - xx;
        const dy = point.y - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    isObjectInBox(obj, minX, minY, maxX, maxY) {
        const bounds = this.getObjectBounds(obj);
        return bounds.minX >= minX && bounds.maxX <= maxX && 
               bounds.minY >= minY && bounds.maxY <= maxY;
    }
    
    getObjectBounds(obj) {
        switch (obj.type) {
            case 'path':
                const xs = obj.points.map(p => p.x);
                const ys = obj.points.map(p => p.y);
                return {
                    minX: Math.min(...xs),
                    maxX: Math.max(...xs),
                    minY: Math.min(...ys),
                    maxY: Math.max(...ys)
                };
            case 'rectangle':
                return {
                    minX: obj.x,
                    maxX: obj.x + obj.width,
                    minY: obj.y,
                    maxY: obj.y + obj.height
                };
            case 'circle':
                return {
                    minX: obj.x - obj.radius,
                    maxX: obj.x + obj.radius,
                    minY: obj.y - obj.radius,
                    maxY: obj.y + obj.radius
                };
            case 'line':
                return {
                    minX: Math.min(obj.x1, obj.x2),
                    maxX: Math.max(obj.x1, obj.x2),
                    minY: Math.min(obj.y1, obj.y2),
                    maxY: Math.max(obj.y1, obj.y2)
                };
            case 'text':
                const textWidth = obj.text.length * obj.size * 0.6;
                return {
                    minX: obj.x,
                    maxX: obj.x + textWidth,
                    minY: obj.y - obj.size/2,
                    maxY: obj.y + obj.size/2
                };
            case 'eraser_stroke':
                return {
                    minX: Math.min(obj.startX, obj.endX) - obj.size/2,
                    maxX: Math.max(obj.startX, obj.endX) + obj.size/2,
                    minY: Math.min(obj.startY, obj.endY) - obj.size/2,
                    maxY: Math.max(obj.startY, obj.endY) + obj.size/2
                };
        }
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    
    moveObject(obj, deltaX, deltaY) {
        switch (obj.type) {
            case 'path':
                obj.points.forEach(point => {
                    point.x += deltaX;
                    point.y += deltaY;
                });
                break;
            case 'rectangle':
                obj.x += deltaX;
                obj.y += deltaY;
                break;
            case 'circle':
                obj.x += deltaX;
                obj.y += deltaY;
                break;
            case 'line':
                obj.x1 += deltaX;
                obj.y1 += deltaY;
                obj.x2 += deltaX;
                obj.y2 += deltaY;
                break;
            case 'text':
                obj.x += deltaX;
                obj.y += deltaY;
                break;
            case 'eraser_stroke':
                obj.startX += deltaX;
                obj.startY += deltaY;
                obj.endX += deltaX;
                obj.endY += deltaY;
                break;
        }
    }
    
    getCursor() {
        switch (this.tool) {
            case 'pen': return this.cursors.pen;
            case 'rectangle': return this.cursors.rectangle;
            case 'circle': return this.cursors.circle;
            case 'line': return this.cursors.line;
            case 'eraser': return 'none'; // We draw our own eraser cursor
            case 'select': return 'default';
            case 'text': return 'text';
            default: return 'crosshair';
        }
    }
    
    // Add mouse tracking for eraser cursor
    updateHoverCursor(e) {
        // Ignore moves not originating from the canvas
        if (e.target !== this.canvas) return;
    
        const pos = this.getMousePos(e);
        if (this.tool === 'eraser' && !this.isDrawing) {
            this.eraserCursorPos = pos;
            this.render();
        } else if (this.tool === 'pen' && !this.isDrawing) {
            this.penCursorPos = pos;
            this.render();
        } else {
            this.penCursorPos = null;
        }
    }
    
    // Public methods
    setTool(tool) {
        this.tool = tool;
        this.canvas.style.cursor = this.getCursor();
        if (tool !== 'eraser') this.eraserCursorPos = null;
        if (tool !== 'pen') this.penCursorPos = null;
        this.clearSelection();
    }
    
    setColor(color) {
        this.toolSettings[this.tool].color = color;
        
        // Update selected objects color
        if (this.selectedObjects.length > 0) {
            this.selectedObjects.forEach(obj => {
                if (obj.type !== 'path' || obj.tool !== 'eraser') {
                    obj.color = color;
                }
            });
            this.render();
            this.saveState();
        }
    }
    
    setSize(size) {
        this.toolSettings[this.tool].size = size;
        
        // Update selected objects size
        if (this.selectedObjects.length > 0) {
            this.selectedObjects.forEach(obj => {
                obj.size = size;
            });
            this.render();
            this.saveState();
        }
    }
    
    getSize() {
        return this.toolSettings[this.tool].size;
    }
    
    getColor() {
        return this.toolSettings[this.tool].color;
    }
    
    clearSelection() {
        this.selectedObjects = [];
        this.render();
    }
    
    selectAll() {
        this.selectedObjects = [...this.objects];
        this.render();
    }
    
    deleteSelectedObjects() {
        this.selectedObjects.forEach(obj => {
            const index = this.objects.indexOf(obj);
            if (index > -1) {
                this.objects.splice(index, 1);
            }
        });
        
        this.selectedObjects = [];
        this.saveState();
        this.render();
    }
    
    clear(saveToHistory = true) {
        this.objects = [];
        this.selectedObjects = [];
        this.canvasOffset = { x: 0, y: 0 };
        this.zoom = 1;
        
        if (saveToHistory) {
            this.saveState();
        }
        
        this.render();
    }
    
    saveState() {
        // Remove future states if we're not at the end
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        // Add new state
        const state = {
            objects: JSON.parse(JSON.stringify(this.objects)),
            canvasOffset: { ...this.canvasOffset },
            zoom: this.zoom
        };
        
        this.history.push(state);
        
        // Limit history size
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
    }
    
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.loadState(this.history[this.historyIndex]);
        }
    }
    
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.loadState(this.history[this.historyIndex]);
        }
    }
    
    loadState(state) {
        this.objects = JSON.parse(JSON.stringify(state.objects));
        this.canvasOffset = { ...state.canvasOffset };
        this.zoom = state.zoom;
        this.selectedObjects = [];
        this.render();
    }
    
    saveAsImage() {
        // Create temporary canvas for export
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        // Calculate bounds of all objects
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        this.objects.forEach(obj => {
            const bounds = this.getObjectBounds(obj);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });
        
        // Add padding
        const padding = 20;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
        
        // Set canvas size
        tempCanvas.width = maxX - minX;
        tempCanvas.height = maxY - minY;
        
        // Set up context
        tempCtx.fillStyle = this.backgroundColor;
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.translate(-minX, -minY);
        
        // Draw all objects
        const originalCtx = this.ctx;
        this.ctx = tempCtx;
        this.objects.forEach(obj => this.drawObject(obj));
        this.ctx = originalCtx;
        
        // Download
        const link = document.createElement('a');
        link.download = 'whiteboard.png';
        link.href = tempCanvas.toDataURL();
        link.click();
    }
    
    resize() {
        this.setupCanvas();
        this.render();
    }
    
    // Pan and zoom methods
    panTo(x, y) {
        this.canvasOffset.x = x;
        this.canvasOffset.y = y;
        this.render();
    }
    
    zoomTo(zoom, centerX = null, centerY = null) {
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
        
        if (centerX !== null && centerY !== null) {
            this.canvasOffset.x = centerX - (centerX - this.canvasOffset.x) * (newZoom / this.zoom);
            this.canvasOffset.y = centerY - (centerY - this.canvasOffset.y) * (newZoom / this.zoom);
        }
        
        this.zoom = newZoom;
        this.render();
    }
    
    resetView() {
        this.canvasOffset = { x: 0, y: 0 };
        this.zoom = 1;
        this.render();
    }
    
    fitToContent() {
        if (this.objects.length === 0) {
            this.resetView();
            return;
        }
        
        // Calculate bounds of all objects
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        this.objects.forEach(obj => {
            const bounds = this.getObjectBounds(obj);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });
        
        // Add padding
        const padding = 50;
        const contentWidth = maxX - minX + 2 * padding;
        const contentHeight = maxY - minY + 2 * padding;
        
        // Calculate zoom to fit
        const canvasWidth = this.canvas.width / this.pixelRatio;
        const canvasHeight = this.canvas.height / this.pixelRatio;
        const zoomX = canvasWidth / contentWidth;
        const zoomY = canvasHeight / contentHeight;
        const newZoom = Math.min(zoomX, zoomY, this.maxZoom);
        
        // Center the content
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        this.zoom = newZoom;
        this.canvasOffset.x = canvasWidth / 2 - centerX * newZoom;
        this.canvasOffset.y = canvasHeight / 2 - centerY * newZoom;
        
        this.render();
    }
}

// Backward compatibility wrapper
class WhiteboardEngine extends AdvancedWhiteboardEngine {
    constructor(canvasId, containerId = null) {
        super(canvasId, containerId);
    }
    
    // Legacy methods for backward compatibility
    setStrokeWidth(width) {
        this.setSize(width);
    }
    
    setStrokeColor(color) {
        this.setColor(color);
    }
}