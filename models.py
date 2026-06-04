"""
课程提醒系统 — 数据库模型
SQLite 单文件存储，零配置
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'courses.db')


def get_db():
    """获取数据库连接，自动启用外键"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # 让查询结果支持 dict 式访问
    conn.execute("PRAGMA foreign_keys = ON")
    # 确保 SQLite 正确处理 UTF-8 文本
    conn.text_factory = str
    return conn


def init_db():
    """初始化数据库表结构"""
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS courses (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            teacher     TEXT    DEFAULT '',
            classroom   TEXT    NOT NULL,
            day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
            start_time  TEXT    NOT NULL,   -- HH:MM 格式
            end_time    TEXT    NOT NULL,   -- HH:MM 格式
            weeks_pattern TEXT  DEFAULT 'every',  -- every / odd / even
            enabled     INTEGER DEFAULT 1,
            created_at  TEXT    DEFAULT (datetime('now', 'localtime'))
        )
    ''')
    conn.commit()
    conn.close()


# ---------- CRUD 操作 ----------

def get_all_courses():
    """获取全部课程，按星期+时间排序"""
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM courses ORDER BY day_of_week, start_time'
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_today_courses(day_of_week, weeks_pattern_filter='all'):
    """
    获取指定星期的课程
    day_of_week: 1-7 (周一到周日)
    weeks_pattern_filter: 'all' / 'every' / 'odd' / 'even'
    """
    conn = get_db()
    if weeks_pattern_filter == 'all':
        rows = conn.execute(
            'SELECT * FROM courses WHERE day_of_week = ? AND enabled = 1 ORDER BY start_time',
            (day_of_week,)
        ).fetchall()
    else:
        # 单周/双周/每周 混合
        rows = conn.execute(
            'SELECT * FROM courses WHERE day_of_week = ? AND enabled = 1 '
            'AND (weeks_pattern = ? OR weeks_pattern = ?) ORDER BY start_time',
            (day_of_week, 'every', weeks_pattern_filter)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_course(name, classroom, day_of_week, start_time, end_time,
               teacher='', weeks_pattern='every'):
    """添加课程，返回新课程的 id"""
    conn = get_db()
    cur = conn.execute(
        'INSERT INTO courses (name, teacher, classroom, day_of_week, '
        'start_time, end_time, weeks_pattern) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (name, teacher, classroom, day_of_week, start_time, end_time, weeks_pattern)
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def update_course(course_id, **kwargs):
    """更新课程字段"""
    allowed = ['name', 'teacher', 'classroom', 'day_of_week',
               'start_time', 'end_time', 'weeks_pattern', 'enabled']
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return False
    set_clause = ', '.join(f'{k} = ?' for k in updates)
    values = list(updates.values()) + [course_id]
    conn = get_db()
    conn.execute(f'UPDATE courses SET {set_clause} WHERE id = ?', values)
    conn.commit()
    affected = conn.total_changes
    conn.close()
    return affected > 0


def delete_course(course_id):
    """删除课程"""
    conn = get_db()
    conn.execute('DELETE FROM courses WHERE id = ?', (course_id,))
    conn.commit()
    affected = conn.total_changes
    conn.close()
    return affected > 0


def get_course_by_id(course_id):
    """按 id 获取单条课程"""
    conn = get_db()
    row = conn.execute('SELECT * FROM courses WHERE id = ?', (course_id,)).fetchone()
    conn.close()
    return dict(row) if row else None
