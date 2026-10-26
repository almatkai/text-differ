#[tokio::main(worker_threads = 2)]
async fn main() {
    if let Err(error) = tezbar_extension_sdk::serve(text_differ_v2::Adapter::default()).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
