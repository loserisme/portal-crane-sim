/* =============================================================
 * report-docx.js — 实训报告导出 Word（.docx）
 *
 * 用 docx.js 在浏览器里直接生成真正的 .docx（不是改后缀的 HTML）。
 * 库体积约 740 KB，首次点击「导出 Word」时才从 CDN 加载。
 * ============================================================= */
(function (w) {
  'use strict';

  var LIB = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
  var loading = null;

  function loadLib() {
    if (w.docx) return Promise.resolve(w.docx);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIB;
      s.onload = function () {
        if (w.docx) resolve(w.docx);
        else reject(new Error('docx 库加载异常'));
      };
      s.onerror = function () { reject(new Error('docx 库加载失败（检查网络）')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  /* ---------------- 生成文档 ---------------- */
  function build(dx, TR) {
    var Fonts = {
      cn: '宋体',
      hei: '黑体',
    };

    function P(text, opt) {
      opt = opt || {};
      return new dx.Paragraph({
        alignment: opt.align || dx.AlignmentType.LEFT,
        spacing: { before: opt.before || 0, after: opt.after === undefined ? 120 : opt.after, line: opt.line || 360 },
        indent: opt.indent,
        children: [new dx.TextRun({
          text: text,
          font: opt.hei ? Fonts.hei : Fonts.cn,
          size: opt.size || 24,          // 24 half-points = 12pt 小四
          bold: !!opt.bold,
          color: opt.color || '000000',
        })],
      });
    }

    function cell(text, opt) {
      opt = opt || {};
      return new dx.TableCell({
        width: opt.width ? { size: opt.width, type: dx.WidthType.PERCENTAGE } : undefined,
        shading: opt.head ? { fill: 'F2ECEC' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new dx.Paragraph({
          alignment: opt.align || dx.AlignmentType.LEFT,
          children: [new dx.TextRun({
            text: String(text),
            font: opt.head ? Fonts.hei : Fonts.cn,
            size: opt.head ? 20 : 20,
            bold: !!opt.head,
          })],
        })],
      });
    }

    var tot = TR.total();
    var d = new Date();
    var dateStr = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';

    var children = [];

    /* 标题 */
    children.push(new dx.Paragraph({
      alignment: dx.AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new dx.TextRun({
        text: '港口门座式起重机运动控制仿真实验',
        font: Fonts.hei, size: 36, bold: true,
      })],
    }));
    children.push(new dx.Paragraph({
      alignment: dx.AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [new dx.TextRun({
        text: '实 训 报 告',
        font: Fonts.hei, size: 28, color: '8C1C2B',
      })],
    }));

    /* 学生信息表 */
    children.push(new dx.Table({
      width: { size: 100, type: dx.WidthType.PERCENTAGE },
      borders: {
        top: { style: dx.BorderStyle.SINGLE, size: 6, color: 'D5D8DD' },
        bottom: { style: dx.BorderStyle.SINGLE, size: 6, color: 'D5D8DD' },
        left: { style: dx.BorderStyle.SINGLE, size: 6, color: 'D5D8DD' },
        right: { style: dx.BorderStyle.SINGLE, size: 6, color: 'D5D8DD' },
        insideHorizontal: { style: dx.BorderStyle.SINGLE, size: 6, color: 'D5D8DD' },
        insideVertical: { style: dx.BorderStyle.SINGLE, size: 6, color: 'D5D8DD' },
      },
      rows: [
        new dx.TableRow({
          children: [
            cell('姓　　名', { head: true, width: 18 }),
            cell(TR.student.name || '　　　　　　', { width: 32 }),
            cell('学　　号', { head: true, width: 18 }),
            cell(TR.student.no || '　　　　　　', { width: 32 }),
          ],
        }),
        new dx.TableRow({
          children: [
            cell('实训日期', { head: true }),
            cell(dateStr),
            cell('总　　分', { head: true }),
            cell(tot.sum + ' / ' + (TR.tasks.length * 100) + ' 分'),
          ],
        }),
      ],
    }));

    children.push(P('', { after: 120 }));

    /* 一、任务得分 */
    children.push(P('一、各任务得分', { hei: true, bold: true, size: 26, before: 160, after: 120 }));

    var rows = [
      new dx.TableRow({
        tableHeader: true,
        children: [
          cell('序号', { head: true, width: 8, align: dx.AlignmentType.CENTER }),
          cell('任务名称', { head: true, width: 34 }),
          cell('得分', { head: true, width: 14, align: dx.AlignmentType.CENTER }),
          cell('评分依据', { head: true, width: 44 }),
        ],
      }),
    ];

    TR.tasks.forEach(function (t, i) {
      var name = t.title.replace(/^任务.·\s*/, '');
      var sc = t.state === 'done' ? (t.score + ' 分')
        : (t.state === 'doing' ? '未完成（进行中）' : '未完成');
      rows.push(new dx.TableRow({
        children: [
          cell(i + 1, { align: dx.AlignmentType.CENTER, width: 8 }),
          cell(name, { width: 34 }),
          cell(sc, { align: dx.AlignmentType.CENTER, width: 14 }),
          cell(t.detail || '—', { width: 44 }),
        ],
      }));
    });

    rows.push(new dx.TableRow({
      children: [
        cell('', { width: 8 }),
        cell('合计', { head: true, width: 34 }),
        cell(tot.sum + ' 分', { head: true, align: dx.AlignmentType.CENTER, width: 14 }),
        cell('完成 ' + tot.done + ' / ' + TR.tasks.length + ' 项', { width: 44 }),
      ],
    }));

    children.push(new dx.Table({
      width: { size: 100, type: dx.WidthType.PERCENTAGE },
      borders: {
        top: { style: dx.BorderStyle.SINGLE, size: 6, color: 'C9B8BA' },
        bottom: { style: dx.BorderStyle.SINGLE, size: 6, color: 'C9B8BA' },
        left: { style: dx.BorderStyle.SINGLE, size: 6, color: 'D5D8DD' },
        right: { style: dx.BorderStyle.SINGLE, size: 6, color: 'D5D8DD' },
        insideHorizontal: { style: dx.BorderStyle.SINGLE, size: 4, color: 'E8EAEE' },
        insideVertical: { style: dx.BorderStyle.SINGLE, size: 4, color: 'E8EAEE' },
      },
      rows: rows,
    }));

    /* 二、操作记录 */
    children.push(P('二、操作记录', { hei: true, bold: true, size: 26, before: 320, after: 120 }));

    var logs = (TR.log || []).slice(-40);
    if (!logs.length) {
      children.push(P('（无）', { indent: { left: 240 } }));
    } else {
      logs.forEach(function (l) {
        children.push(P('[' + l.t + ']  ' + l.msg, {
          size: 21, after: 40, line: 300, indent: { left: 240 },
        }));
      });
    }

    /* 三、实验分析（留白） */
    children.push(P('三、实验分析与结论', { hei: true, bold: true, size: 26, before: 320, after: 120 }));
    children.push(P('（请结合任务二的高度变化数据、任务四的路径规划方案，以及任务五的程序实现，分析四连杆水平变幅特性与作业效率的关系。）', {
      size: 21, color: '666666',
    }));
    for (var i2 = 0; i2 < 6; i2++) {
      children.push(P('', { after: 200 }));
    }

    return new dx.Document({
      styles: {
        default: {
          document: { run: { font: Fonts.cn, size: 24 } },
        },
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },     // A4
            margin: { top: 1247, right: 1134, bottom: 1247, left: 1247 },
          },
        },
        children: children,
      }],
    });
  }

  /* ---------------- 对外接口 ---------------- */
  var RD = {};

  /* 只生成不下载，便于外部验证或二次处理 */
  RD.buildBlob = function (TR) {
    if (!TR || !TR.tasks || !TR.tasks.length) return Promise.reject(new Error('没有实训数据'));
    return loadLib().then(function (dx) {
      return dx.Packer.toBlob(build(dx, TR));
    });
  };

  RD.export = function (TR) {
    return RD.buildBlob(TR).then(function (blob) {
      var name = (TR.student.no || '未填学号') + '-' + (TR.student.name || '未填姓名') + '-门机仿真实训报告.docx';
      download(blob, name);
      return name;
    });
  };

  RD.isReady = function () { return !!w.docx; };

  w.REPORT_DOCX = RD;
})(window);
