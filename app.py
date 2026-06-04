"""
课程提醒系统 — Flask 主入口
PC 启动服务，手机通过局域网访问
"""

from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
from datetime import datetime
import models

# 强制 Flask JSON 不转义中文
app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False
CORS(app)


# ==================== 页面路由 ====================

@app.route('/')
def index():
    """主页面 — 单页面应用"""
    return render_template('index.html')


@app.route('/manifest.json')
def manifest():
    """PWA 清单文件"""
    return send_from_directory('static', 'manifest.json')


@app.route('/sw.js')
def service_worker():
    """Service Worker 脚本"""
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')


# ==================== 课程 API ====================

@app.route('/api/courses', methods=['GET'])
def list_courses():
    """获取所有课程"""
    courses = models.get_all_courses()
    return jsonify({'ok': True, 'data': courses})


@app.route('/api/courses', methods=['POST'])
def create_course():
    """添加课程"""
    data = request.get_json(force=True)
    required = ['name', 'classroom', 'day_of_week', 'start_time', 'end_time']
    for field in required:
        if field not in data or not data[field]:
            return jsonify({'ok': False, 'error': f'缺少必填字段: {field}'}), 400

    new_id = models.add_course(
        name=data['name'],
        classroom=data['classroom'],
        day_of_week=int(data['day_of_week']),
        start_time=data['start_time'],
        end_time=data['end_time'],
        teacher=data.get('teacher', ''),
        weeks_pattern=data.get('weeks_pattern', 'every'),
    )
    course = models.get_course_by_id(new_id)
    return jsonify({'ok': True, 'data': course}), 201


@app.route('/api/courses/<int:course_id>', methods=['PUT'])
def update_course(course_id):
    """修改课程"""
    data = request.get_json(force=True)
    success = models.update_course(course_id, **data)
    if not success:
        return jsonify({'ok': False, 'error': '课程不存在或没有有效更新字段'}), 404
    course = models.get_course_by_id(course_id)
    return jsonify({'ok': True, 'data': course})


@app.route('/api/courses/<int:course_id>', methods=['DELETE'])
def delete_course(course_id):
    """删除课程"""
    success = models.delete_course(course_id)
    if not success:
        return jsonify({'ok': False, 'error': '课程不存在'}), 404
    return jsonify({'ok': True, 'message': '已删除'})


# ==================== 今日课程 API ====================

@app.route('/api/today')
def today_courses():
    """
    获取今日课程
    支持查询参数:
      - weeks_pattern: 按单双周过滤（不传则返回全部）
    """
    # Python datetime: 1=周一 ... 7=周日
    today_dow = datetime.now().isoweekday()
    weeks_filter = request.args.get('weeks_pattern', 'all')

    courses = models.get_today_courses(today_dow, weeks_filter)

    # 附加当前时间用于前端判断
    now_str = datetime.now().strftime('%H:%M')

    return jsonify({
        'ok': True,
        'data': courses,
        'today': {
            'day_of_week': today_dow,
            'day_name': ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][today_dow],
            'now': now_str,
        }
    })


# ==================== 启动 ====================

if __name__ == '__main__':
    # 强制 UTF-8 输出，避免 Windows 终端编码问题
    import sys, io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    print()
    print('=' * 50)
    print('  [Course Reminder] 课程提醒系统')
    print('=' * 50)

    # 初始化数据库
    print('  [*] 初始化数据库...')
    models.init_db()
    print('  [OK] 数据库就绪')

    # 打印本机 IP
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = '127.0.0.1'

    print(f'  [PC] 本机地址: http://{local_ip}:5000')
    print(f'  [Phone] 手机访问: http://{local_ip}:5000')
    print('=' * 50)
    print()

    # Render 会通过 PORT 环境变量指定端口
    import os
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
