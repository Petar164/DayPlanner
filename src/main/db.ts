import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'

export type Tag = {
  id: string
  name: string
  color: string
}

export type Task = {
  id: string
  title: string
  taskDate: string
  startTime: string
  endTime: string
  tagId: string | null
  notes: string
  fixed: number
  done: number
}

export type PlannerState = {
  tags: Tag[]
  tasks: Task[]
}

let db: Database.Database

export const initDb = (): void => {
  const dbPath = path.join(app.getPath('userData'), 'planner.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      taskDate TEXT NOT NULL,
      startTime TEXT NOT NULL,
      endTime TEXT NOT NULL,
      tagId TEXT,
      notes TEXT NOT NULL,
      fixed INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(tagId) REFERENCES tags(id)
    );
  `)

  // Migrate existing databases that don't have the done column yet
  const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]
  if (!cols.some((c) => c.name === 'done')) {
    db.exec('ALTER TABLE tasks ADD COLUMN done INTEGER NOT NULL DEFAULT 0')
  }
  if (!cols.some((c) => c.name === 'taskDate')) {
    db.exec("ALTER TABLE tasks ADD COLUMN taskDate TEXT NOT NULL DEFAULT ''")
    const today = new Date().toISOString().slice(0, 10)
    db.prepare("UPDATE tasks SET taskDate = ? WHERE taskDate = ''").run(today)
  }

  seedIfEmpty()
}

const seedIfEmpty = (): void => {
  const tagCount = db.prepare('SELECT COUNT(*) as count FROM tags').get() as { count: number }
  if (tagCount.count > 0) return

  const seedTags: Tag[] = [
    { id: 'tag-work',    name: 'Work',    color: '#6C8CFF' },
    { id: 'tag-family',  name: 'Family',  color: '#FF8CCF' },
    { id: 'tag-errands', name: 'Errands', color: '#7CFFB2' }
  ]

  const seedTasks: Task[] = [
    {
      id: 'task-1', title: 'Deep work block',
      taskDate: new Date().toISOString().slice(0, 10),
      startTime: '08:00', endTime: '10:30',
      tagId: 'tag-work', notes: 'Focus mode, no meetings', fixed: 1, done: 0
    },
    {
      id: 'task-2', title: 'Family call',
      taskDate: new Date().toISOString().slice(0, 10),
      startTime: '12:30', endTime: '13:00',
      tagId: 'tag-family', notes: 'Check in and plan weekend', fixed: 1, done: 0
    },
    {
      id: 'task-3', title: 'Grocery pickup',
      taskDate: new Date().toISOString().slice(0, 10),
      startTime: '17:30', endTime: '18:00',
      tagId: 'tag-errands', notes: 'Bring reusable bags', fixed: 0, done: 0
    },
    {
      id: 'task-4', title: 'Creative learning',
      taskDate: new Date().toISOString().slice(0, 10),
      startTime: '19:00', endTime: '20:00',
      tagId: 'tag-work', notes: 'Portfolio improvements', fixed: 0, done: 0
    }
  ]

  const insertTag  = db.prepare('INSERT INTO tags (id, name, color) VALUES (@id, @name, @color)')
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, taskDate, startTime, endTime, tagId, notes, fixed, done)
    VALUES (@id, @title, @taskDate, @startTime, @endTime, @tagId, @notes, @fixed, @done)
  `)

  const insert = db.transaction(() => {
    seedTags.forEach((tag)   => insertTag.run(tag))
    seedTasks.forEach((task) => insertTask.run(task))
  })
  insert()
}

export const getState = (): PlannerState => {
  const tags  = db.prepare('SELECT * FROM tags ORDER BY name').all() as Tag[]
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY taskDate, startTime').all() as Task[]
  return { tags, tasks }
}

export const saveState = (state: PlannerState): PlannerState => {
  const clearTags  = db.prepare('DELETE FROM tags')
  const clearTasks = db.prepare('DELETE FROM tasks')
  const insertTag  = db.prepare('INSERT INTO tags (id, name, color) VALUES (@id, @name, @color)')
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, taskDate, startTime, endTime, tagId, notes, fixed, done)
    VALUES (@id, @title, @taskDate, @startTime, @endTime, @tagId, @notes, @fixed, @done)
  `)

  const tx = db.transaction(() => {
    clearTasks.run()
    clearTags.run()
    state.tags.forEach((tag)   => insertTag.run(tag))
    state.tasks.forEach((task) => insertTask.run(task))
  })
  tx()
  return getState()
}
