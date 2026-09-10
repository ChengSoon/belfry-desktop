use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use std::fmt;

struct Strict(Value);
impl<'de> Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(StrictVisitor)
    }
}
struct StrictVisitor;
impl<'de> Visitor<'de> for StrictVisitor {
    type Value = Strict;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("JSON without duplicate keys")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut access: A) -> Result<Strict, A::Error> {
        let mut map = serde_json::Map::new();
        while let Some(key) = access.next_key::<String>()? {
            if map.contains_key(&key) {
                return Err(de::Error::custom(format!("重复 JSON 键：{key}")));
            }
            map.insert(key, access.next_value::<Strict>()?.0);
        }
        Ok(Strict(Value::Object(map)))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut access: A) -> Result<Strict, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = access.next_element::<Strict>()? {
            values.push(value.0);
        }
        Ok(Strict(Value::Array(values)))
    }
    fn visit_str<E: de::Error>(self, value: &str) -> Result<Strict, E> {
        Ok(Strict(Value::String(value.into())))
    }
    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Strict, E> {
        Ok(Strict(Value::Bool(value)))
    }
    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Strict, E> {
        Ok(Strict(value.into()))
    }
    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Strict, E> {
        Ok(Strict(value.into()))
    }
    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Strict, E> {
        Ok(Strict(value.into()))
    }
    fn visit_unit<E: de::Error>(self) -> Result<Strict, E> {
        Ok(Strict(Value::Null))
    }
}
pub fn parse<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    let mut decoder = serde_json::Deserializer::from_slice(bytes);
    let value = Strict::deserialize(&mut decoder).map_err(|e| e.to_string())?;
    decoder.end().map_err(|e| e.to_string())?;
    serde_json::from_value(value.0).map_err(|e| format!("格式无效（不支持旧插件 registry）：{e}"))
}
