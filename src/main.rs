//! andruavauth: the DroneEngage authentication server.

#[tokio::main]
async fn main() {
    de_auth_server::cli::run().await;
}
