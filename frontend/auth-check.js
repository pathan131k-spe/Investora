(async function(){

  try{

    const response = await fetch("/api/me");
    const data = await response.json();

    if(!data.loggedIn){

      window.location.href = "/";
      return;
    }

    window.currentUser = data.user;

  }catch(error){

    console.log("Authentication check failed");

    window.location.href = "/";
  }

})();
