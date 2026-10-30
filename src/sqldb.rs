//! The SQLite connection as node-sqlite3 drives it (helpers/hlp_db.js and
//! the admin routes' db.get/all/run): positional `?` parameters bound the
//! way node-sqlite3 binds JavaScript values, rows as objects in column
//! order, errors as `SQLITE_<CODE>: <message>` with code and errno.

use rusqlite::types::{Value as SqlValue, ValueRef};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::Mutex;

use droneengage_server_common::util::{is_undefined, json_number_f64};

/// A node-sqlite3 error: `err.message`, `err.code`, `err.errno`.
#[derive(Clone, Debug, PartialEq)]
pub struct SqlError {
    pub errno: i64,
    pub code: String,
    pub message: String,
}

impl SqlError {
    fn new(p_errno: i64, p_detail: &str) -> SqlError {
        let v_code = code_name(p_errno).to_string();
        SqlError { errno: p_errno, message: format!("{}: {}", v_code, p_detail), code: v_code }
    }

    /// The error as JSON.stringify shows it (message is not enumerable).
    pub fn to_value(&self) -> Value {
        json!({ "errno": self.errno, "code": self.code })
    }

    /// How console.log/console.error prints the error object.
    pub fn inspect(&self) -> String {
        format!("[Error: {}] {{\n  errno: {},\n  code: '{}'\n}}", self.message, self.errno, self.code)
    }
}

fn code_name(p_errno: i64) -> &'static str {
    match p_errno {
        1 => "SQLITE_ERROR",
        2 => "SQLITE_INTERNAL",
        3 => "SQLITE_PERM",
        4 => "SQLITE_ABORT",
        5 => "SQLITE_BUSY",
        6 => "SQLITE_LOCKED",
        7 => "SQLITE_NOMEM",
        8 => "SQLITE_READONLY",
        9 => "SQLITE_INTERRUPT",
        10 => "SQLITE_IOERR",
        11 => "SQLITE_CORRUPT",
        12 => "SQLITE_NOTFOUND",
        13 => "SQLITE_FULL",
        14 => "SQLITE_CANTOPEN",
        15 => "SQLITE_PROTOCOL",
        16 => "SQLITE_EMPTY",
        17 => "SQLITE_SCHEMA",
        18 => "SQLITE_TOOBIG",
        19 => "SQLITE_CONSTRAINT",
        20 => "SQLITE_MISMATCH",
        21 => "SQLITE_MISUSE",
        22 => "SQLITE_NOLFS",
        23 => "SQLITE_AUTH",
        24 => "SQLITE_FORMAT",
        25 => "SQLITE_RANGE",
        26 => "SQLITE_NOTADB",
        _ => "SQLITE_ERROR",
    }
}

fn from_rusqlite(p_err: rusqlite::Error) -> SqlError {
    match p_err {
        rusqlite::Error::SqliteFailure(e, v_msg) => {
            let v_primary = (e.extended_code & 0xff) as i64;
            let v_detail = v_msg.unwrap_or_else(|| e.to_string());
            SqlError::new(v_primary, &v_detail)
        }
        rusqlite::Error::SqlInputError { error, msg, .. } => SqlError::new((error.extended_code & 0xff) as i64, &msg),
        other => SqlError::new(1, &other.to_string()),
    }
}

/// `{ lastID, changes }` of a run().
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RunResult {
    pub last_id: i64,
    pub changes: i64,
}

/// How node-sqlite3 binds one JavaScript value: Int32 numbers as INTEGER,
/// other numbers as REAL, booleans as 0/1, strings as TEXT, null/undefined
/// as NULL and objects as their String() ("[object Object]").
pub fn bind_value(p_value: &Value) -> SqlValue {
    match p_value {
        Value::Null => SqlValue::Null,
        v if is_undefined(v) => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            let f = json_number_f64(n);
            if f.is_nan() {
                SqlValue::Null
            } else if f.fract() == 0.0 && f >= i32::MIN as f64 && f <= i32::MAX as f64 {
                SqlValue::Integer(f as i64)
            } else {
                SqlValue::Real(f)
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Array(_) | Value::Object(_) => SqlValue::Text("[object Object]".into()),
    }
}

fn row_value(p_value: ValueRef<'_>) -> Value {
    match p_value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => crate::jsv::num(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        // a Buffer, as JSON.stringify writes one
        ValueRef::Blob(b) => json!({ "type": "Buffer", "data": b }),
    }
}

/// The database (`global.m_db`).
pub struct SqlDb {
    m_conn: Mutex<rusqlite::Connection>,
}

impl SqlDb {
    /// new sqlite3.Database(path): creates the file when missing.
    pub fn open(p_path: &Path) -> Result<SqlDb, SqlError> {
        let v_conn = rusqlite::Connection::open(p_path).map_err(from_rusqlite)?;
        Ok(SqlDb { m_conn: Mutex::new(v_conn) })
    }

    /// An in-memory database (tests).
    pub fn memory() -> SqlDb {
        SqlDb { m_conn: Mutex::new(rusqlite::Connection::open_in_memory().unwrap()) }
    }

    fn with_stmt<T>(
        &self,
        p_sql: &str,
        p_params: &[Value],
        p_body: impl FnOnce(&mut rusqlite::Statement<'_>, &rusqlite::Connection) -> Result<T, SqlError>,
    ) -> Result<T, SqlError> {
        let v_conn = self.m_conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut v_stmt = v_conn.prepare(p_sql).map_err(from_rusqlite)?;
        let v_count = v_stmt.parameter_count();
        for (i, v) in p_params.iter().enumerate() {
            if i >= v_count {
                return Err(SqlError::new(25, "column index out of range"));
            }
            v_stmt.raw_bind_parameter(i + 1, bind_value(v)).map_err(from_rusqlite)?;
        }
        p_body(&mut v_stmt, &v_conn)
    }

    /// db.all(sql, params)
    pub fn all(&self, p_sql: &str, p_params: &[Value]) -> Result<Vec<Value>, SqlError> {
        self.with_stmt(p_sql, p_params, |v_stmt, _| {
            let v_names: Vec<String> = v_stmt.column_names().iter().map(|s| s.to_string()).collect();
            let mut v_rows = v_stmt.raw_query();
            let mut v_out = Vec::new();
            while let Some(v_row) = v_rows.next().map_err(from_rusqlite)? {
                let mut m = Map::new();
                for (i, v_name) in v_names.iter().enumerate() {
                    let v = row_value(v_row.get_ref(i).map_err(from_rusqlite)?);
                    m.insert(v_name.clone(), v);
                }
                v_out.push(Value::Object(m));
            }
            Ok(v_out)
        })
    }

    /// db.get(sql, params): the first row (None = undefined).
    pub fn get(&self, p_sql: &str, p_params: &[Value]) -> Result<Option<Value>, SqlError> {
        Ok(self.all(p_sql, p_params)?.into_iter().next())
    }

    /// db.run(sql, params): `this.lastID` / `this.changes`.
    pub fn run(&self, p_sql: &str, p_params: &[Value]) -> Result<RunResult, SqlError> {
        self.with_stmt(p_sql, p_params, |v_stmt, v_conn| {
            let mut v_rows = v_stmt.raw_query();
            while v_rows.next().map_err(from_rusqlite)?.is_some() {}
            Ok(RunResult { last_id: v_conn.last_insert_rowid(), changes: v_conn.changes() as i64 })
        })
    }

    /// db.exec(sql): several statements.
    pub fn exec(&self, p_sql: &str) -> Result<(), SqlError> {
        let v_conn = self.m_conn.lock().unwrap_or_else(|e| e.into_inner());
        v_conn.execute_batch(p_sql).map_err(from_rusqlite)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binds_and_errors_like_node_sqlite3() {
        let db = SqlDb::memory();
        db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT UNIQUE, b INTEGER, c)").unwrap();
        let r = db
            .run("INSERT INTO t (a, b, c) VALUES (?, ?, ?)", &[json!("x"), json!(4294967295u32), json!(true)])
            .unwrap();
        assert_eq!(r, RunResult { last_id: 1, changes: 1 });
        db.run("INSERT INTO t (a, b, c) VALUES (?, ?, ?)", &[json!("y"), json!(1.5), json!({"k": 1})]).unwrap();
        db.run("INSERT INTO t (a) VALUES (?)", &[json!("z")]).unwrap();
        let v_rows = db.all("SELECT * FROM t ORDER BY id", &[]).unwrap();
        assert_eq!(
            Value::Array(v_rows),
            json!([
                {"id": 1, "a": "x", "b": 4294967295u32, "c": 1},
                {"id": 2, "a": "y", "b": 1.5, "c": "[object Object]"},
                {"id": 3, "a": "z", "b": null, "c": null}
            ])
        );
        let e = db.run("INSERT INTO t (a) VALUES (?)", &[json!("x")]).unwrap_err();
        assert_eq!(e.code, "SQLITE_CONSTRAINT");
        assert_eq!(e.errno, 19);
        assert_eq!(e.message, "SQLITE_CONSTRAINT: UNIQUE constraint failed: t.a");
        let e = db.all("SELECT * FROM t WHERE id = ?", &[json!(1), json!(2)]).unwrap_err();
        assert_eq!(e.message, "SQLITE_RANGE: column index out of range");
        let e = db.all("SELECT * FROM nope", &[]).unwrap_err();
        assert_eq!(e.message, "SQLITE_ERROR: no such table: nope");
        assert_eq!(db.get("SELECT a FROM t WHERE id = ?", &[json!(9)]).unwrap(), None);
    }
}
