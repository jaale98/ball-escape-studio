/**
 * WebGL2 ball layer for crowds: every ball (and trail ghost) is one instance
 * of a quad, shaded as a disc with a soft rim and optional glow. Thousands of
 * balls cost one draw call. The layer is drawn into the 2D canvas with
 * drawImage, so overlays, rings and export work unchanged.
 */
import { HEIGHT, WIDTH } from '../engine/scene';

const VERT = `#version 300 es
in vec2 corner;
in vec4 inst;     // x, y, radius, glow (0/1)
in vec4 color;    // r, g, b, alpha
uniform vec2 world;
out vec2 local;
out vec4 vColor;
out float vGlow;
out float vSize;
void main() {
  float size = inst.w > 0.5 ? 2.2 : 1.06;
  local = corner * size;
  vColor = color;
  vGlow = inst.w;
  vSize = inst.z;
  vec2 p = inst.xy + corner * inst.z * size;
  gl_Position = vec4(p.x / world.x * 2.0 - 1.0, 1.0 - p.y / world.y * 2.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 local;
in vec4 vColor;
in float vGlow;
in float vSize;
out vec4 outColor;
void main() {
  float d = length(local);
  float aa = 1.5 / max(vSize, 1.0);
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  // White rim on solid balls.
  float rim = vColor.a > 0.99 ? smoothstep(0.80, 0.90, d) * disc * 0.8 : 0.0;
  vec3 c = mix(vColor.rgb, vec3(1.0), rim);
  float a = disc * vColor.a;
  float glow = vGlow > 0.5 ? exp(-3.5 * max(d - 1.0, 0.0)) * (1.0 - disc) * 0.45 : 0.0;
  outColor = vec4(c * a + vColor.rgb * glow, a + glow);
}`;

export class GlBallLayer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private instBuf: WebGLBuffer;
  private colorBuf: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private inst = new Float32Array(4 * 1024);
  private color = new Float32Array(4 * 1024);
  private n = 0;
  private colors = new Map<string, [number, number, number]>();

  static create(scale: number): GlBallLayer | null {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(WIDTH * scale);
    canvas.height = Math.round(HEIGHT * scale);
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
    return gl ? new GlBallLayer(canvas, gl) : null;
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.uniform2f(gl.getUniformLocation(prog, 'world'), WIDTH, HEIGHT);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(prog, 'corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    const inst = gl.getAttribLocation(prog, 'inst');
    gl.enableVertexAttribArray(inst);
    gl.vertexAttribPointer(inst, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(inst, 1);

    this.colorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    const col = gl.getAttribLocation(prog, 'color');
    gl.enableVertexAttribArray(col);
    gl.vertexAttribPointer(col, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(col, 1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, r: number, color: string, alpha: number, glow: boolean): void {
    if (this.n * 4 >= this.inst.length) {
      const grow = (a: Float32Array) => {
        const b = new Float32Array(a.length * 2);
        b.set(a);
        return b;
      };
      this.inst = grow(this.inst);
      this.color = grow(this.color);
    }
    const [cr, cg, cb] = this.rgb(color);
    const i = this.n * 4;
    this.inst[i] = x;
    this.inst[i + 1] = y;
    this.inst[i + 2] = r;
    this.inst[i + 3] = glow ? 1 : 0;
    this.color[i] = cr;
    this.color[i + 1] = cg;
    this.color[i + 2] = cb;
    this.color[i + 3] = alpha;
    this.n++;
  }

  /** Draw everything added since begin(); returns the canvas to composite. */
  flush(): HTMLCanvasElement {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.n) {
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.inst.subarray(0, this.n * 4), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.color.subarray(0, this.n * 4), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    }
    return this.canvas;
  }

  private rgb(color: string): [number, number, number] {
    let c = this.colors.get(color);
    if (!c) {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
      c = m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
      this.colors.set(color, c);
    }
    return c;
  }
}
