"""Tkinter operator console. Run: python gui.py (Python 3.10+)."""
from __future__ import annotations
import argparse
import csv
import json
from pathlib import Path
import queue
import threading
import time
import tkinter as tk
from tkinter import filedialog, ttk
import webbrowser

from crane_ws import BridgeServer, Crane, AlgorithmRunner
from self_test import run_tests

SAMPLE = '''# 本地 Python 算法；crane 接口与网页 Python 一致
import math
t = 0.0

def setup():
    crane.speed(1)
    crane.slew(0)
    crane.radius(27)
    crane.hoist(15)
    crane.grab(0)
    crane.snap()
    crane.seg_name("正弦回转", 0)
    crane.log("本地 Python 算法启动")

def control(dt):
    global t
    t += dt
    state = crane.status()
    crane.slew(20 * math.sin(t / 5))
'''


class App:
    def __init__(self, root, args):
        self.root, self.args = root, args
        self.messages = queue.Queue()
        self.server, self.runner = None, None
        self.busy = False
        self.closing = False
        self.auto_started = False
        self.report = None
        self.shutdown_done = threading.Event()
        self.test_cancelled = threading.Event()
        root.title('港口门机 · Python WebSocket 控制台')
        root.geometry(f'{min(1120, root.winfo_screenwidth()-60)}x{min(760, root.winfo_screenheight()-140)}+30+30')
        root.minsize(900, 600)
        root.configure(background='#eef3f7')
        style = ttk.Style()
        style.theme_use('clam')
        style.configure('TFrame', background='#eef3f7')
        style.configure('TLabelframe', background='#eef3f7')
        style.configure('TLabel', background='#eef3f7', foreground='#183247', font=('Microsoft YaHei UI', 10))
        style.configure('Title.TLabel', font=('Microsoft YaHei UI', 18, 'bold'))
        style.configure('TButton', padding=(10, 7), font=('Microsoft YaHei UI', 9))
        style.configure('Accent.TButton', background='#147a85', foreground='white')
        outer = ttk.Frame(root, padding=18)
        outer.pack(fill='both', expand=True)
        ttk.Label(outer, text='门机远程实验台', style='Title.TLabel').pack(anchor='w')
        ttk.Label(outer, text='WebSocket 连接 · 实时状态 · 手动操作 · 本地 Python 算法').pack(anchor='w', pady=(2,12))
        connection = ttk.LabelFrame(outer, text='连接仿真页面', padding=10)
        connection.pack(fill='x')
        self.url = tk.StringVar(value=args.url)
        self.url_entry = ttk.Entry(connection, textvariable=self.url)
        self.url_entry.grid(row=0, column=0, sticky='ew', padx=(0,8))
        connection.columnconfigure(0, weight=1)
        self.start_button = ttk.Button(connection, text='启动服务', command=self.start_server)
        self.start_button.grid(row=0, column=1)
        self.open_button = ttk.Button(connection, text='打开并配对网页', command=self.open_page)
        self.open_button.grid(row=0, column=2, padx=6)
        self.stop_button = ttk.Button(connection, text='关闭服务', command=lambda: self.work(self.stop_server))
        self.stop_button.grid(row=0, column=3)
        self.connection_text = tk.StringVar(value='尚未启动服务')
        ttk.Label(connection, textvariable=self.connection_text).grid(row=1, column=0, columnspan=4, sticky='w', pady=6)
        self.token = tk.StringVar()
        ttk.Entry(connection, textvariable=self.token, show='•', state='readonly').grid(row=2, column=0, sticky='ew')
        ttk.Button(connection, text='复制配对口令', command=self.copy_token).grid(row=2, column=1)
        ttk.Label(connection, text=f'仅监听本机 · 端口 {args.port}').grid(row=2, column=2)
        ttk.Button(connection, text='停止控制', command=self.stop_control, style='Accent.TButton').grid(row=2, column=3)

        notebook = ttk.Notebook(outer)
        notebook.pack(fill='both', expand=True, pady=12)
        manual_host = ttk.Frame(notebook)
        canvas = tk.Canvas(manual_host, highlightthickness=0, background='#eef3f7')
        scroll = ttk.Scrollbar(manual_host, orient='vertical', command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side='right', fill='y'); canvas.pack(side='left', fill='both', expand=True)
        manual = ttk.Frame(canvas, padding=12)
        manual_window = canvas.create_window((0, 0), window=manual, anchor='nw')
        manual.bind('<Configure>', lambda event: canvas.configure(scrollregion=canvas.bbox('all')))
        canvas.bind('<Configure>', lambda event: canvas.itemconfigure(manual_window, width=event.width))
        algorithm = ttk.Frame(notebook, padding=12)
        notebook.add(manual_host, text='  操作与状态  ')
        notebook.add(algorithm, text='  Python 算法  ')
        manual.columnconfigure(0, weight=1)
        manual.columnconfigure(1, weight=1)
        controls = ttk.LabelFrame(manual, text='机构目标值', padding=12)
        controls.grid(row=0, column=0, sticky='nsew', padx=(0,12))
        self.inputs = {}
        axes = [('slew', '回转角 / °', 0), ('radius', '幅度 / m', 27), ('hoist', '起升高度 / m', 15), ('grab', '开度 / 0～1', 0), ('travel', '行走 / m', 0), ('speed', '仿真倍速', 1), ('slew_rate', '回转角速度 / °/s', 0)]
        self.axis_buttons = {}
        for row, (name, label, default) in enumerate(axes):
            ttk.Label(controls, text=label).grid(row=row, column=0, sticky='w', pady=5)
            value = tk.StringVar(value=str(default))
            self.inputs[name] = value
            ttk.Entry(controls, textvariable=value, width=10).grid(row=row, column=1, padx=8)
            button = ttk.Button(controls, text='设置', command=lambda n=name: self.manual(n))
            button.grid(row=row, column=2)
            self.axis_buttons[name] = button
        buttons = ttk.Frame(controls)
        buttons.grid(row=len(axes), column=0, columnspan=3, sticky='w', pady=12)
        for name, label in [('acquire','接管'), ('snap','立即到位'), ('slew_free','退出速度控制'), ('reset','复位')]:
            ttk.Button(buttons, text=label, command=lambda n=name: self.manual(n)).pack(side='left', padx=2)
        ttk.Button(controls, text='停止算法 / 释放控制', command=self.stop_control, style='Accent.TButton').grid(row=len(axes)+1, column=0, columnspan=3, sticky='ew')
        status = ttk.LabelFrame(manual, text='实时状态（摆角单位 rad）', padding=10)
        status.grid(row=0, column=1, sticky='nsew')
        self.state_view = ttk.Treeview(status, columns=('value',), show='tree headings', height=16)
        self.state_view.heading('#0', text='字段')
        self.state_view.heading('value', text='当前值')
        self.state_view.column('#0', width=145)
        self.state_view.column('value', width=170)
        self.state_view.pack(fill='both', expand=True)
        toolbar = ttk.Frame(manual)
        toolbar.grid(row=1, column=0, columnspan=2, sticky='ew', pady=10)
        for name, label in [('plot','显示曲线'), ('mark','下一对比段'), ('plot_compare','对比曲线'), ('clear_plot','清空曲线')]:
            ttk.Button(toolbar, text=label, command=lambda n=name: self.manual(n)).pack(side='left', padx=3)
        self.test_button = ttk.Button(toolbar, text='一键接口自检（会复位场景）', command=self.run_self_test)
        self.test_button.pack(side='right')
        ttk.Button(toolbar, text='导出记录 CSV', command=self.export_records).pack(side='right', padx=4)
        self.editor = tk.Text(algorithm, wrap='none', undo=True, background='#152f42', foreground='#dfebf3', insertbackground='white', font=('Consolas', 11), height=15)
        self.editor.pack(fill='both', expand=True)
        self.editor.insert('1.0', SAMPLE)
        actions = ttk.Frame(algorithm)
        actions.pack(fill='x', pady=(10,0))
        self.run_button = ttk.Button(actions, text='运行本地算法', command=self.run_algorithm, style='Accent.TButton')
        self.run_button.pack(side='left')
        ttk.Button(actions, text='停止', command=self.stop_control).pack(side='left', padx=8)
        ttk.Button(actions, text='加载 .py', command=self.load_algorithm).pack(side='left')
        ttk.Label(actions, text='支持 setup() / control(dt)；dt 为仿真秒，约 20 Hz 状态驱动').pack(side='right')
        self.log_view = tk.Text(outer, height=5, wrap='word', background='#fff', foreground='#254254', font=('Consolas', 10), state='disabled')
        self.log_view.pack(side='bottom', fill='x', before=notebook)
        root.protocol('WM_DELETE_WINDOW', self.close)
        root.after(100, self.poll)
        if args.start or args.self_test:
            root.after(200, self.start_server)

    def log(self, text): self.messages.put(('log', str(text)))

    def work(self, fn):
        if self.busy:
            self.log('正在执行任务，请稍候')
            return
        self.busy = True
        def worker():
            try: fn()
            except Exception as exc: self.log('错误：' + str(exc))
            finally: self.busy = False
        threading.Thread(target=worker, daemon=True).start()

    def start_server(self):
        if self.server and not self.server.closed.is_set(): return
        try:
            self.server = BridgeServer(self.args.port, self.url.get().strip(), self.log).start()
            self.runner = AlgorithmRunner(self.server, self.log)
            self.token.set(self.server.token)
            if self.args.ready_file:
                Path(self.args.ready_file).write_text(json.dumps({'url':self.server.pairing_url(), 'port':self.server.port}), encoding='utf-8')
        except Exception as exc:
            self.log('服务启动失败：' + str(exc))

    def stop_server(self):
        self.test_cancelled.set()
        try:
            if self.runner: self.runner.stop()
        finally:
            if self.server: self.server.stop()

    def open_page(self):
        self.start_server()
        if self.server and self.server.server:
            webbrowser.open(self.server.pairing_url())

    def copy_token(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.token.get())
        self.log('配对口令已复制')

    def manual(self, method):
        value = self.inputs[method].get() if method in self.inputs else None
        def execute():
            if self.runner and self.runner.running: raise RuntimeError('请先停止算法再手动控制')
            if not self.server: raise RuntimeError('请先启动服务并连接网页')
            crane = Crane(self.server)
            crane.acquire()
            result = getattr(crane, method)(float(value)) if value is not None else getattr(crane, method)()
            self.log(method + ' → ' + str(result))
        self.work(execute)

    def run_algorithm(self):
        code = self.editor.get('1.0', 'end')
        if self.busy: return
        try:
            if not self.runner: raise RuntimeError('请先启动服务')
            self.runner.start(code)
            self.log('本地算法开始运行')
        except Exception as exc: self.log(str(exc))

    def stop_control(self):
        self.test_cancelled.set()
        # Stop remains available while a background action waits for a reply.
        def stop():
            try:
                if self.runner: self.runner.stop()
            except Exception as exc: self.log(str(exc))
        threading.Thread(target=stop, daemon=True).start()

    def load_algorithm(self):
        path = filedialog.askopenfilename(filetypes=[('Python', '*.py')])
        if path:
            try:
                code = Path(path).read_text(encoding='utf-8-sig')
                self.editor.delete('1.0', 'end'); self.editor.insert('1.0', code)
            except Exception as exc: self.log(str(exc))

    def export_records(self):
        path = filedialog.asksaveasfilename(defaultextension='.csv', filetypes=[('CSV', '*.csv')])
        if not path: return
        def export():
            data = Crane(self.server).records()['samples']
            if not data: raise ValueError('暂无曲线记录')
            with open(path, 'w', newline='', encoding='utf-8-sig') as handle:
                writer = csv.DictWriter(handle, fieldnames=list(data[0]))
                writer.writeheader(); writer.writerows(data)
            self.log('记录已导出：' + path)
        self.work(export)

    def run_self_test(self):
        if self.busy: return
        if self.runner and self.runner.running:
            self.log('请先停止算法'); return
        def test():
            result = {'ok':False, 'url':self.args.url, 'checks':[]}
            try:
                if not self.server or not self.server.ready.is_set(): raise RuntimeError('请先连接网页')
                result['checks'] = run_tests(self.server, self.log, self.test_cancelled)
                result['ok'] = True
            except Exception as exc:
                result['error'] = str(exc)
                self.log('FAIL · ' + str(exc))
            self.report = result
            if self.args.report:
                Path(self.args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            self.log('自检完成：' + ('全部通过' if result['ok'] else '存在失败，查看日志'))
        self.test_cancelled.clear()
        self.work(test)

    def poll(self):
        if self.closing: return
        while not self.messages.empty():
            _, text = self.messages.get_nowait()
            self.log_view.configure(state='normal')
            self.log_view.insert('end', text + '\n')
            if int(self.log_view.index('end-1c').split('.')[0]) > 400: self.log_view.delete('1.0','100.0')
            self.log_view.see('end'); self.log_view.configure(state='disabled')
        connected = bool(self.server and self.server.ready.is_set())
        self.url_entry.configure(state='readonly' if self.server and self.server.server else 'normal')
        state = self.server.latest if connected else None
        running = bool(self.runner and self.runner.running)
        self.connection_text.set(('已连接 · ' + ('远程控制中' if state and state['active'] else '等待接管')) if connected else ('服务已启动 · 等待网页连接' if self.server and self.server.server else '服务已关闭'))
        for button in [*self.axis_buttons.values(), self.run_button, self.test_button]:
            button.configure(state='normal' if connected and not self.busy and not running else 'disabled')
        if state:
            for key, value in state['state'].items():
                value = json.dumps(value, ensure_ascii=False) if isinstance(value, dict) else str(value)
                if self.state_view.exists(key): self.state_view.item(key, values=(value,))
                else: self.state_view.insert('', 'end', iid=key, text=key, values=(value,))
        elif self.state_view.get_children(): self.state_view.delete(*self.state_view.get_children())
        if self.args.self_test and connected and not self.auto_started:
            self.auto_started = True
            # Exercise the actual GUI callback rather than a separate test-only path.
            self.test_button.invoke()
        if self.args.auto_exit and self.report is not None and not self.busy:
            self.root.after(600, self.close)
            return
        self.root.after(100, self.poll)

    def close(self):
        if self.closing: return
        self.closing = True
        def shutdown():
            try: self.stop_server()
            finally: self.shutdown_done.set()
        threading.Thread(target=shutdown, daemon=True).start()
        deadline = time.monotonic() + 7
        def await_close():
            if self.shutdown_done.is_set() or time.monotonic() > deadline:
                self.root.destroy()
            else: self.root.after(100, await_close)
        self.root.after(300, await_close)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='https://loserisme.github.io/portal-crane-sim/?v=20261103h')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--start', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--auto-exit', action='store_true')
    parser.add_argument('--ready-file')
    parser.add_argument('--report')
    args = parser.parse_args()
    root = tk.Tk()
    app = App(root, args)
    root.mainloop()
    if args.self_test and (not app.report or not app.report['ok']): raise SystemExit(1)


if __name__ == '__main__': main()
