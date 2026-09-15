//! 按实际保留的容器容量和字符串容量估算；不累计已经处理并释放的记录。

const CONTROL_GROUP_BYTES: usize = 16;

pub(crate) fn table_bytes<T>(capacity: usize) -> usize {
    if capacity == 0 {
        return 0;
    }
    // std HashMap/HashSet 的 capacity 不含空槽；补齐桶数、控制字节及对齐空间。
    capacity.next_power_of_two() * (size_of::<T>() + 1) + CONTROL_GROUP_BYTES + align_of::<T>() - 1
}

pub(crate) fn optional_string(value: &Option<String>) -> usize {
    value.as_ref().map_or(0, String::capacity)
}
