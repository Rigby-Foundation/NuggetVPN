fn main() {
    println!("Testing root permissions");
    let status = std::process::Command::new("ifconfig").arg("utun1989").status();
    println!("ifconfig status: {:?}", status);
}
