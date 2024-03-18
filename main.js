// TODO: replace let with const where possible
// TODO: make functions more pure

const APP_ID = '';

// For a real application, maybe use Primary Certificate authorisation as well as making sure user IDs are unique
const token = null;
const uid = Math.floor(Math.random() * 10000).toString();

let client;
let channel;

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const roomId = urlParams.get('room');

if (!roomId) {
    window.location = './lobby.html';
}

let peerConnection;
let localStream;

const servers = {

    iceServers: [ // STUN servers used to find ICE candidates
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        }
    ]
};

const init = async () => { // Used const rather than let in spite of video

    client = await AgoraRTM.createInstance(APP_ID); // To be used for communication

    await client.login({ uid, token }); // Can communicate via Agora after authentication

    channel = client.createChannel(roomId); // Channel name; in an application with multiple rooms, this could be dynamic

    await channel.join(); // *This happens before the event listener below is set up, meaning that the below event listener doesn't trigger on the side of the user that's just joined

    channel.on('MemberJoined', handleUserJoined); // I.E. if someone joins a channel of the same name (main) in the Same Agora application. Runs for the current session, other sessions on the same machine and remote sessions as well

    channel.on('MemberLeft', handleUserLeft); // NOTE: this doesn't unconditionally happen a member closes their page; it's only because of the beforeunload event listener being added to the window that upon a user closing their window the leaveChannel callback will be invoked, in which channel.leave() will cause a MemberLeft event. If not for this, Agora would take longer to fire the MemberLeft event (I think 30 seconds by default)

    client.on('MessageFromPeer', handleMessageFromPeer); // There's an extremely small chance that the message from the peer due to the MemberJoined event listener firing on their side will be received by the local peer before the MessageFromPeer event listener is set up, in which case handleMessageFromPeer would not be locally invoked in this case; however, the chance is extremely small

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); // Assinging local video track to this object

    document.getElementById('user-1').srcObject = localStream; // Assigning local video track to user-1 element in webpage for video display
}

const handleUserLeft = async (memberId) => {

    document.getElementById('user-2').style.display = 'none';
}

// TODO: maybe call this handleIncomingMessage in case you can send yourself a message, also probably change memberId to senderId
const handleMessageFromPeer = async (message, memberId) => { // memberId comes from peer

    message = JSON.parse(message.text);

    if (message.type === 'offer') { // Can pass for Joiner 2

        createAnswer(memberId, message.offer);
    }

    if (message.type === 'answer') { // Can pass for Joiner 1

        addAnswer(message.answer);
    }

    if (message.type === 'candidate') { // createPeerConnection, in which candidates are sent, is run in both createOffer and createAnswer, I.E. by both Joiner 1 and Joiner 2 respectively, so both can receive candidate messages and this can pass for both

        if (peerConnection) {

            peerConnection.addIceCandidate(message.candidate);
        }
    }
}

// TODO: change memberId to joinerId
const handleUserJoined = async (memberId) => {

    console.log('A new user joined the channel:', memberId);

    createOffer(memberId);
}

const createPeerConnection = async function (memberId) {

    peerConnection = new RTCPeerConnection(servers); // Creates an object representing connection from peer to peer but doesn't actually establish a connection yet; here, ICE servers are provided for when a connection is indeed established

    remoteStream = new MediaStream(); // This will just contain the video track from the peer

    document.getElementById('user-2').srcObject = remoteStream; // Assigns peer video track to user-2 element (although we haven't actually received the video track yet)

    document.getElementById('user-2').style.display = 'block';

    // TODO: decide on a better way to ensure localStream is created before use than repeating it here (since it's already done in init)
    if (!localStream) {

        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); // Assinging local video track to this object

        document.getElementById('user-1').srcObject = localStream; // Assigning local video track to user-1 element in webpage for video display
    }

    localStream.getTracks().forEach(track => {

        peerConnection.addTrack(track, localStream); // Provides local video track to peer. addTrack is set up to receive a track and a stream because tracks with streams helps in managing multiple tracks as part of the same logical grouping or stream, which is particularly useful when there are multiple media streams being sent or received. This can be helpful for synchronisation
    });

    peerConnection.ontrack = (e => { // This doesn't fire on this machine as a result of the peerConnection.addTrack invocation on the same machine (as the above is done before setting up this event listener) but instead fires on this machine when peerConnection.addTrack is invoked on the other machine, meaning this event listener loads tracks from the peer alone

        e.streams[0].getTracks().forEach(track => { // In peerConnection.addTrack, only one stream is ever provided: the localStream. As a result, e.streams should only contain one stream

            remoteStream.addTrack(track); // Storing tracks from peer locally for display locally
        })
    });

    peerConnection.onicecandidate = async (e) => { // Should fire when peerConnection.setLocalDescription is invoked locally

        const candidate = e.candidate;

        if (candidate) { // It's not guaranteed that the STUN server will find an ICE candidate

            client.sendMessageToPeer({ text: JSON.stringify({
                'type': 'candidate',
                candidate,
            })}, memberId);
        }
    }
}

const createOffer = async (memberId) => { // In this application, a video call between 2 people, this only runs on the 1st joiner's machine, specifically when the 2nd joiner joins; Ctrl+f for * for why this is

    await createPeerConnection(memberId);

    const offer = await peerConnection.createOffer(); // Here, the SDP offer is created based on peer information but it's not actually sent

    await peerConnection.setLocalDescription(offer); // The generated SDP offer is stored at the local end of the peer connection. This will fire icecandidate events, which makes requests to the STUN servers for ICE candidates and return it to the local end

    client.sendMessageToPeer({ text: JSON.stringify({
        'type': 'offer',
        offer,
    })}, memberId); // Sends message from local to peer with an ID of memberId. This results in the peer's client instance experiencing a MessageFromPeer event
}

const createAnswer = async (memberId, offer) => { // Given the comment next to createOffer, this function only runs for the 2nd joiner because it's in createOffer that an offer is sent and it's only when an offer is sent that createAnswer is invoked

    await createPeerConnection(memberId); // For 2nd joiner, this is necessary because createOffer wasn't invoked, meaning createPeerConnection hasn't yet been run

    await peerConnection.setRemoteDescription(offer); // This registers the offer as coming from the peer ("remote")

    let answer = await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(answer); // This registers the answer as coming from the local

    client.sendMessageToPeer({ text: JSON.stringify({
        'type': 'answer',
        answer,
    })}, memberId); // Sends message from local to peer with an ID of memberId. This results in the peer's client instance experiencing a MessageFromPeer event
}

const addAnswer = async (answer) => { // Runs for joiner 1 (see comment next to createAnswer, knowing addAnswer is only invoked after the answer is sent by that function to the peer of the entity running it)

    if (!peerConnection.currentRemoteDescription) { // The remote description may already have been sent (by addAnswer running previously) but signalling errors (e.g. due to network issues) could lead to the receipt of another answer

        peerConnection.setRemoteDescription(answer); // By this point, Joiner 1 has invoked createOffer, in which Joiner 1 has established their local description; Joiner 2 has invoked createAnswer, in which it has established the description of its remote and then its own local description; now here, Joiner 1 is finally establishing the description of its own remote. Joiner 1's remote is Joiner 2 and vice versa; Joiner 1's local is Joiner 1 and the converse applies for Joiner 2.
    }
}

const leaveChannel = async () => {
    await channel.leave();
    await client.logout();
}

// NOTE: toggleCamera and toggleMic may be bad when video and audio aren't enabled from the jump
const toggleCamera = async (e) => {
    const videoTrack = localStream.getTracks().find(track => track.kind === 'video');
    videoTrack.enabled = !videoTrack.enabled;
    e.target.style.backgroundColor = (videoTrack.enabled) ? null: 'rgb(255, 80, 80)';
}

const toggleMic = async (e) => {
    const audioTrack = localStream.getTracks().find(track => track.kind === 'audio');
    audioTrack.enabled = !audioTrack.enabled;
    e.target.style.backgroundColor = (audioTrack.enabled) ? null: 'rgb(255, 80, 80)';
}

window.addEventListener('beforeunload', leaveChannel);

const cameraBtn = document.getElementById('camera-btn');
cameraBtn.addEventListener('click', (e) => toggleCamera(e));

const micBtn = document.getElementById('mic-btn');
micBtn.addEventListener('click', (e) => toggleMic(e));

init();
